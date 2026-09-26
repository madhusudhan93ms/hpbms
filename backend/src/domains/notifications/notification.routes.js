import { Router } from 'express';
import { verifyJwt } from '../../middleware/verifyJwt.js';
import { NotificationService } from './notification.service.js';

const router = Router();
router.use(verifyJwt);

// Get notifications & unread badge count (supports view=active|history|all, page, limit)
router.get('/', async (req, res, next) => {
  try {
    const { id: userId, role, hospitalId, branchId, additionalRoles } = req.user;
    const { view = 'active', page = 1, limit = 30 } = req.query;
    const result = await NotificationService.getNotifications({
      userId,
      role,
      hospitalId,
      branchId,
      additionalRoles,
      view: String(view).toLowerCase(),
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 30)),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Get unread badge count only
router.get('/unread-count', async (req, res, next) => {
  try {
    const { id: userId, role, hospitalId, branchId, additionalRoles } = req.user;
    const count = await NotificationService.getUnreadCount({ userId, role, hospitalId, branchId, additionalRoles });
    res.json({ unreadCount: count });
  } catch (err) {
    next(err);
  }
});

// Mark single notification as read
router.patch('/:id/read', async (req, res, next) => {
  try {
    const notification = await NotificationService.markAsRead(req.params.id, req.user);
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    res.json(notification);
  } catch (err) {
    next(err);
  }
});

// Mark single notification task as completed
router.patch('/:id/complete', async (req, res, next) => {
  try {
    const notification = await NotificationService.markAsCompleted(req.params.id, req.user);
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    res.json(notification);
  } catch (err) {
    next(err);
  }
});

router.delete('/clear-all', async (req, res, next) => {
  try {
    res.json(await NotificationService.clearAll(req.user));
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const notification = await NotificationService.clear(req.params.id, req.user);
    if (!notification) return res.status(404).json({ message: 'Notification not found' });
    res.json(notification);
  } catch (err) { next(err); }
});

// Mark all as read for specific route/module
router.post('/read-route', async (req, res, next) => {
  try {
    const { route } = req.body;
    const result = await NotificationService.markRouteAsRead(route, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Mark all as read
router.post('/read-all', async (req, res, next) => {
  try {
    const { id: userId, role, hospitalId, branchId, additionalRoles } = req.user;
    const result = await NotificationService.markAllAsRead({ userId, role, hospitalId, branchId, additionalRoles });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
