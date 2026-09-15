import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';

class SocketManager {
  constructor() {
    this.io = null;
    this.onlineUsers = new Map(); // userId -> socketId / count
  }

  getOnlineUserIds() {
    return new Set(this.onlineUsers.keys());
  }

  init(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: (origin, callback) => {
          // Dynamically reflect origin to remain 100% compliant with credentials: true
          callback(null, true);
        },
        credentials: true,
      },
      allowEIO3: true,
      transports: ['websocket', 'polling'],
    });

    this.io.use(async (socket, next) => {
      const rawToken = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!rawToken) {
        return next(new Error('Authentication token required for WebSocket handshake'));
      }
      const token = typeof rawToken === 'string' && rawToken.startsWith('Bearer ')
        ? rawToken.slice(7).trim()
        : rawToken;
      try {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        const userId = decoded.id || decoded._id;
        const currentUser = await User.findOne({
          _id: userId,
          isActive: { $ne: false },
          status: { $nin: ['INACTIVE', 'SUSPENDED'] },
        }).select('_id name role additionalRoles hospitalId branchId');
        if (!currentUser) return next(new Error('WebSocket account is inactive or no longer exists'));
        socket.user = {
          ...decoded,
          id: String(currentUser._id),
          name: currentUser.name,
          role: currentUser.role,
          additionalRoles: currentUser.additionalRoles || [],
          hospitalId: currentUser.hospitalId || null,
          branchId: currentUser.branchId || null,
        };
        next();
      } catch (err) {
        console.warn('[Socket.IO Auth Warning] Token verification failed:', err.message);
        next(new Error('Invalid WebSocket token'));
      }
    });

    this.io.on('connection', async (socket) => {
      console.log(`[Socket.IO] Client Connected: ${socket.id} (User: ${socket.user.name}, Role: ${socket.user.role})`);

      // Auto join user to hospital, branch, user and role rooms
      const rawHospId = socket.user.hospitalId?._id || socket.user.hospitalId;
      const rawBranchId = socket.user.branchId?._id || socket.user.branchId;
      const rawUserId = socket.user.id || socket.user._id;
      const isPortalIdentity = ['PATIENT', 'GUARDIAN'].includes(socket.user.role);

      if (rawUserId) {
        const uIdStr = String(rawUserId);
        const cur = this.onlineUsers.get(uIdStr) || 0;
        this.onlineUsers.set(uIdStr, cur + 1);
        if (rawHospId) {
          this.io.to(`hospital:${rawHospId}`).emit('staff:presence_changed', { userId: uIdStr, isOnline: true });
        }
      }

      if (rawHospId && !isPortalIdentity) {
        socket.join(`hospital_${rawHospId}`);
        socket.join(`hospital:${rawHospId}`);
      }
      if (rawBranchId && !isPortalIdentity) {
        socket.join(`branch_${rawBranchId}`);
      }
      if (rawUserId) {
        socket.join(`user_${rawUserId}`);
      }

      const roles = new Set([socket.user.role].filter(Boolean));
      try {
        const currentUser = await User.findById(rawUserId).select('role additionalRoles hospitalId branchId');
        if (currentUser?.role) roles.add(currentUser.role);
        for (const role of currentUser?.additionalRoles || []) roles.add(role);
        if (currentUser?.hospitalId && !isPortalIdentity) {
          socket.join(`hospital_${currentUser.hospitalId}`);
          socket.join(`hospital:${currentUser.hospitalId}`);
        }
        if (currentUser?.branchId && !isPortalIdentity) socket.join(`branch_${currentUser.branchId}`);
      } catch (error) {
        console.error(`[Socket.IO] Could not refresh roles for ${rawUserId}:`, error.message);
      }

      roles.forEach((role) => {
        socket.join(`role_${role}`);
        if (rawHospId && !isPortalIdentity) socket.join(`hospital_${rawHospId}_role_${role}`);
        if (rawBranchId && !isPortalIdentity) socket.join(`branch_${rawBranchId}_role_${role}`);
      });

      socket.on('join_ward', (wardId) => {
        if (isPortalIdentity) return;
        socket.join(`ward_${wardId}`);
        console.log(`[Socket.IO] ${socket.user.name} joined ward_${wardId}`);
      });

      socket.on('chat:typing', (data) => {
        if (data?.recipientId) {
          this.emitToUser(String(data.recipientId), 'chat:typing', {
            senderId: socket.user.id || socket.user._id,
            senderName: socket.user.name,
            channel: data.channel || 'DIRECT',
            isTyping: data.isTyping !== false,
          });
        } else if (data?.channel && rawHospId) {
          socket.to(`hospital:${rawHospId}`).emit('chat:typing', {
            senderId: socket.user.id || socket.user._id,
            senderName: socket.user.name,
            channel: data.channel,
            isTyping: data.isTyping !== false,
          });
        }
      });

      socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client Disconnected: ${socket.id}`);
        if (rawUserId) {
          const uIdStr = String(rawUserId);
          const cur = this.onlineUsers.get(uIdStr) || 1;
          if (cur <= 1) {
            this.onlineUsers.delete(uIdStr);
            if (this.io && rawHospId) {
              this.io.to(`hospital:${rawHospId}`).emit('staff:presence_changed', { userId: uIdStr, isOnline: false });
            }
          } else {
            this.onlineUsers.set(uIdStr, cur - 1);
          }
        }
      });
    });

    console.log('[Socket.IO] Server Initialized Successfully');
  }

  /**
   * Emit to all sockets in a specific branch room.
   * NEVER falls back to global broadcast — scoped to branch only.
   */
  emitToBranch(branchId, event, data) {
    if (this.io) {
      if (branchId) {
        this.io.to(`branch_${branchId}`).emit(event, data);
      }
      const rawHosp = data?.hospitalId?._id || data?.hospitalId || data?.hospital?._id || data?.hospital;
      if (rawHosp) {
        this.io.to(`hospital_${rawHosp}`).emit(event, data);
        this.io.to(`hospital:${rawHosp}`).emit(event, data);
      }
    }
  }

  /**
   * Emit to all sockets in a specific hospital room.
   * Use this instead of io.emit() for hospital-scoped events.
   */
  emitToHospital(hospitalId, event, data) {
    if (this.io && hospitalId) {
      const rawHosp = hospitalId?._id || hospitalId;
      this.io.to(`hospital_${rawHosp}`).emit(event, data);
      this.io.to(`hospital:${rawHosp}`).emit(event, data);
    }
  }

  /**
   * Emit to all sockets in a specific role room.
   * NEVER falls back to global broadcast — scoped to role only.
   */
  emitToRole(role, event, data) {
    if (this.io && role) {
      this.io.to(`role_${role}`).emit(event, data);
    }
  }

  emitToHospitalRole(hospitalId, role, event, data) {
    if (this.io && hospitalId && role) {
      this.io.to(`hospital_${hospitalId}_role_${role}`).emit(event, data);
    }
  }

  emitToBranchRole(branchId, role, event, data) {
    if (this.io && branchId && role) {
      this.io.to(`branch_${branchId}_role_${role}`).emit(event, data);
    }
  }

  emitToUser(userId, event, data) {
    if (this.io && userId) {
      this.io.to(`user_${userId}`).emit(event, data);
    }
  }

  emitToWard(wardId, event, data) {
    if (this.io) {
      this.io.to(`ward_${wardId}`).emit(event, data);
    }
  }

  /**
   * Emit to multiple role rooms simultaneously.
   * NEVER falls back to global broadcast.
   */
  emitToRoles(roles, event, data) {
    if (this.io && Array.isArray(roles)) {
      roles.forEach((role) => {
        this.io.to(`role_${role}`).emit(event, data);
      });
    }
  }

  emitEmergency(event, data, scope = {}) {
    if (this.io) {
      const branchId = scope.branchId || data?.branchId;
      const hospitalId = scope.hospitalId || data?.hospitalId;
      if (!branchId && !hospitalId) return;
      const responderRoles = ['DOCTOR', 'NURSE', 'NURSE_INCHARGE', 'IPD_STAFF', 'EMERGENCY_STAFF'];
      responderRoles.forEach((role) => {
        const room = branchId
          ? `branch_${branchId}_role_${role}`
          : `hospital_${hospitalId}_role_${role}`;
        const target = this.io.to(room);
        target.emit('emergency:alert', data);
        target.emit('emergency:code_blue_triggered', data);
        if (event !== 'emergency:alert' && event !== 'emergency:code_blue_triggered') {
          target.emit(event, data);
        }
      });
    }
  }

  broadcastCodeBlue(data) {
    this.emitEmergency('emergency:code_blue_triggered', data, data || {});
  }
}

export const socketManager = new SocketManager();
