import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const { token, isAuthenticated } = useAuthStore();
  const [socket, setSocket] = useState(null);
  const [activeCodeBlue, setActiveCodeBlue] = useState(null);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    const socketInstance = io('/', {
      auth: { token },
      autoConnect: true,
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socketInstance.on('connect', () => {
      console.log('[Socket.IO Client] Connected to server successfully');
    });

    socketInstance.on('connect_error', (err) => {
      console.warn('[Socket.IO Client] Real-time sync connection notice:', err.message);
    });

    socketInstance.on('emergency:code_blue_triggered', (data) => {
      console.warn('[EMERGENCY] Code Blue Received!', data);
      setActiveCodeBlue(data);
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, [token, isAuthenticated]);

  const dismissCodeBlue = React.useCallback(() => setActiveCodeBlue(null), []);

  const contextValue = React.useMemo(() => ({
    socket,
    activeCodeBlue,
    dismissCodeBlue,
  }), [socket, activeCodeBlue, dismissCodeBlue]);

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
