const express = require('express');
const {
  getMe,
  listProjects,
  getProject,
  createProjectHandler,
  getProjectDashboard,
  deleteProjectHandler
} = require('../controllers/projectController');

const router = express.Router();

router.get('/me', getMe);
router.get('/projects', listProjects);
router.post('/projects', createProjectHandler);
router.get('/projects/:projectId', getProject);
router.get('/projects/:projectId/dashboard', getProjectDashboard);
router.delete('/projects/:projectId', deleteProjectHandler);

module.exports = router;