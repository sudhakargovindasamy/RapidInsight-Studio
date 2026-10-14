import { Navigate, Route, Routes } from 'react-router-dom';

import { ProjectRefreshProvider } from './context/ProjectRefreshContext.jsx';

import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './components/layout/AppLayout.jsx';

import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import ProjectWorkspacePage from './pages/ProjectWorkspacePage.jsx';
import ProjectReportPage from './pages/ProjectReportPage.jsx';
import SchemaUploadPage from './pages/SchemaUploadPage.jsx';
import MySchemasPage from './pages/MySchemasPage.jsx';
import StoragePage from './pages/StoragePage.jsx';
import WorkspacePage from './pages/WorkspacePage.jsx';
import TablesPage from './pages/TablesPage.jsx';
import TableViewerPage from './pages/TableViewerPage.jsx';
import SchemaPlaygroundPage from './pages/SchemaPlaygroundPage.jsx';
import DataCatalogPage from './pages/DataCatalogPage.jsx';
import RegistryAssetPage from './pages/RegistryAssetPage.jsx';
import DataIngestionPage from './pages/DataIngestionPage.jsx';

function App() {
  return (
    <ProjectRefreshProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectWorkspacePage />} />
          <Route
            path="/projects/:projectId/registry-asset"
            element={<RegistryAssetPage />}
          />
          <Route
            path="/projects/:projectId/data-ingestion"
            element={<DataIngestionPage />}
          />
          <Route
            path="/projects/:projectId/playground"
            element={<SchemaPlaygroundPage />}
          />
          <Route
            path="/projects/:projectId/reports"
            element={<ProjectReportPage />}
          />
          <Route
            path="/projects/:projectId/catalog"
            element={<DataCatalogPage />}
          />
          <Route
            path="/projects/:projectId/catalog/history/:historyId"
            element={<DataCatalogPage />}
          />
          <Route
            path="/projects/:projectId/tables/:generatedTableId"
            element={<TableViewerPage />}
          />
          <Route path="/schema-upload" element={<SchemaUploadPage />} />
          <Route path="/schemas" element={<MySchemasPage />} />
          <Route path="/storage" element={<StoragePage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/tables" element={<TablesPage />} />
          <Route
            path="/tables/:generatedTableId"
            element={<TableViewerPage />}
          />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ProjectRefreshProvider>
  );
}

export default App;