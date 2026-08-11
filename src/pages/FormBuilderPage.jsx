import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import FormBuilder from '../components/setup/FormBuilder'

// Must match HomePage.jsx's JUST_CREATED_TEMPLATE_KEY exactly — not shared
// as an import since the two pages don't otherwise depend on each other,
// but this key is how they hand off across the navigation back to '/'.
const JUST_CREATED_TEMPLATE_KEY = 'eniac_just_created_template_id'

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
    const created = await api.createCustomTemplate({ name, description: '', formSchema: schema })
    // HomePage's New Project modal was left open (its own state stashed in
    // sessionStorage before navigating here) — this is what lets it
    // auto-select the form just built, rather than the person having to
    // find and pick it again from the list.
    if (created?.id) sessionStorage.setItem(JUST_CREATED_TEMPLATE_KEY, created.id)
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