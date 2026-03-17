const express    = require('express');
const router     = express.Router();
const auth       = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/authenticate');

router.post('/login',           auth.login);
router.post('/logout',          auth.logout);
router.get('/me',               authenticate, auth.me);
router.post('/change-password', authenticate, auth.changePassword);  // ← Phase 2 addition

module.exports = router;
