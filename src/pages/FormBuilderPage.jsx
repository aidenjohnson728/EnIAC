import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import FormBuilder from '../components/setup/FormBuilder'

// Standalone "Make Form" entry point — independent of any project. Reuses
// the existing FormBuilder component as-is (same editor experience as
// editing a form inside a project's Setup page) via its saveOverride prop,
// which bypasses the project-scoped save path (api.saveForm + the
// password-lock check) and instead saves the finished schema as a new
// custom template. That template then shows up in Template Projects on the
// homepage, immediately usable to create a real project from — same as the
// built-in SDMo/UCAT templates.
export default function FormBuilderPage() {
  const navigate = useNavigate()

  async function handleSaveOverride({ name, schema }) {
    await api.createCustomTemplate({ name, description: '', formSchema: schema })
  }

  return (
    <FormBuilder
      projectId={null}
      form={{}}
      saveOverride={handleSaveOverride}
      onSave={() => navigate('/')}
      onCancel={() => navigate('/')}
    />
  )
}