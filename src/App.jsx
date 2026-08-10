import { HashRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ProjectPage from './pages/ProjectPage'
import ReviewPage from './pages/ReviewPage'
import SetupPage from './pages/SetupPage'
import WorkspacePage from './pages/WorkspacePage'
import FormBuilderPage from './pages/FormBuilderPage'
import AppUpdateGate from './components/ui/AppUpdateGate'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:projectId" element={<ProjectPage />} />
        <Route path="/project/:projectId/setup" element={<SetupPage />} />
        <Route path="/review/:reviewId" element={<ReviewPage />} />
        <Route path="/workspace/:reviewId" element={<WorkspacePage />} />
        <Route path="/form-builder" element={<FormBuilderPage />} />
      </Routes>
      <AppUpdateGate />
    </HashRouter>
  )
}