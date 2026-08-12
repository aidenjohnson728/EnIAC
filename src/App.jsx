import { createContext, useContext, useState, useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import ProjectPage from './pages/ProjectPage'
import ReviewPage from './pages/ReviewPage'
import SetupPage from './pages/SetupPage'
import WorkspacePage from './pages/WorkspacePage'
import FormBuilderPage from './pages/FormBuilderPage'
import AppUpdateGate from './components/ui/AppUpdateGate'
import { api } from './lib/api'

// Manual light/dark toggle (not prefers-color-scheme — this follows a saved
// choice, not the OS setting). Stored via the same app-settings mechanism
// already used for reviewer_name, so no backend changes were needed.
// data-theme on <html> is what index.css's [data-theme="dark"] block reads.
const ThemeContext = createContext(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within App')
  return ctx
}

export default function App() {
  const [theme, setTheme] = useState('light')

  useEffect(() => {
    api.getAppSettings().then(s => {
      if (s.theme === 'dark') setTheme('dark')
    })
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    api.setAppSettings({ theme: next })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
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
    </ThemeContext.Provider>
  )
}