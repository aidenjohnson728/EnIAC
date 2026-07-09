const { saveForm, saveMediaType } = require('./structure')

const DEFAULT_PROJECTS = [
  {
    id: 'ucat',
    name: 'UCAT',
    description: '',
    forms: [
      {
        name: 'UCAT',
        schema: {
          sections: [
            {
              id: 'el_1783368967705_c97k',
              title: 'Section 1',
              description: '',
              elements: [
                {
                  id: 'el_1783368976626_apjw',
                  type: 'likert_group',
                  label: 'Category 1a',
                  description: '',
                  scale: 5,
                  low_label: 'Strongly Disagree',
                  high_label: 'Strongly Agree',
                  has_na: false,
                  items: [
                    { id: 'el_1783557737553_vk0p', label: 'Participants did not try to rush the conversation.' },
                    { id: 'el_1783557746738_d8mu', label: 'Participants held the conversation at a natural pace.' },
                  ],
                  required: true,
                },
                {
                  id: 'el_1783370480860_jbz3',
                  type: 'likert_group',
                  label: 'Category 1b',
                  description: '',
                  scale: 5,
                  low_label: 'Strongly Disagree',
                  high_label: 'Strongly Agree',
                  has_na: false,
                  items: [
                    { id: 'el_1783557757869_4qyg', label: 'Participants asked open-ended questions that encouraged participation from the other.' },
                    { id: 'el_1783557761536_43t2', label: 'Participants asked questions that allowed the other to share additional information.' },
                  ],
                  required: true,
                },
                {
                  id: 'el_1783370609150_cg4o',
                  type: 'likert_group',
                  label: 'Category 1c',
                  description: '',
                  scale: 5,
                  low_label: 'Strongly Disagree',
                  high_label: 'Strongly Agree',
                  has_na: false,
                  items: [
                    { id: 'el_1783557772868_a8wv', label: 'Each of the participants took appropriate turns in the conversation.' },
                    { id: 'el_1783557778436_mxdh', label: 'Both participants contributed to the conversational rhythm.' },
                  ],
                  required: true,
                },
                {
                  id: 'el_1783371261565_8svy',
                  type: 'likert_group',
                  label: 'Category 1d',
                  description: '',
                  scale: 5,
                  low_label: 'Strongly Disagree',
                  high_label: 'Strongly Agree',
                  has_na: false,
                  items: [
                    { id: 'el_1783557784021_3pk5', label: 'Participants helped maintain the flow of the conversation.' },
                    { id: 'el_1783557787252_2gvn', label: 'Participants were able to complete their conversational turns without the other interrupting.' },
                    { id: 'el_1783557792868_85gm', label: 'Participants allowed the other to speak without interruption.' },
                  ],
                  required: true,
                },
              ],
            },
            {
              id: 'el_1783371420738_c3n9',
              title: 'Section 2',
              description: '',
              elements: [
                {
                  id: 'el_1783371833481_olsl',
                  type: 'likert_group',
                  label: 'Category 2',
                  description: '',
                  scale: 5,
                  low_label: 'Strongly Disagree',
                  high_label: 'Strongly Agree',
                  has_na: false,
                  items: [
                    { id: 'el_1783557849835_4tpr', label: 'Participants were able to pause without being interrupted by the other.' },
                    { id: 'el_1783557855102_bcj7', label: 'Participants allowed each other to pause.' },
                  ],
                  required: true,
                },
              ],
            },
            {
              id: 'el_1783371917601_mh6j',
              title: 'Section 3',
              description: '',
              elements: [
                {
                  id: 'el_1783371927708_c12n',
                  type: 'likert_group',
                  label: 'Category 3',
                  description: '',
                  scale: 5,
                  low_label: 'Strongly Disagree',
                  high_label: 'Strongly Agree',
                  has_na: false,
                  items: [
                    { id: 'el_1783557866450_q5sr', label: 'Participants expressed emotions.' },
                    { id: 'el_1783557869869_0cvk', label: 'Participants expressed emotions that were acknowledged by the other.' },
                    { id: 'el_1783557873884_u1r6', label: 'Participants allowed time for the expressions of emotion to be processed.' },
                  ],
                  required: true,
                },
              ],
            },
            {
              id: 'el_1783372023292_and8',
              title: 'Section 4',
              description: '',
              elements: [
                {
                  id: 'el_1783372032475_ttyl',
                  type: 'likert_group',
                  label: 'Category 4',
                  description: '',
                  scale: 5,
                  low_label: 'Strongly Disagree',
                  high_label: 'Strongly Agree',
                  has_na: true,
                  items: [
                    { id: 'el_1783557881817_sosd', label: 'An external factor (e.g., person, event) interrupted the conversation.' },
                    { id: 'el_1783557886650_rfa1', label: 'An external factor disrupted the flow of conversation.' },
                    { id: 'el_1783557890285_bpwn', label: 'Either participant was prevented from completing their conversational turn because of outside factors.' },
                  ],
                  required: true,
                },
              ],
            },
            {
              id: 'el_1783372152356_dtfa',
              title: 'Section 5',
              description: '',
              elements: [
                {
                  id: 'el_1783372161095_01ev',
                  type: 'likert_group',
                  label: 'Category 5',
                  description: '',
                  scale: 5,
                  low_label: 'Strongly Disagree',
                  high_label: 'Strongly Agree',
                  has_na: true,
                  items: [
                    { id: 'el_1783557896501_4fid', label: 'Participants displayed body language that was open to the other.' },
                    { id: 'el_1783557900467_3x8j', label: 'Participants displayed body language that indicated they were available for the conversation.' },
                    { id: 'el_1783557904000_6no8', label: 'Participants were visibly engaged in what the other was saying.' },
                  ],
                  required: true,
                },
              ],
            },
            {
              id: 'el_1783372245675_g6rd',
              title: 'Section 6',
              description: '',
              elements: [
                {
                  id: 'el_1783372268676_bnxd',
                  type: 'likert_group',
                  label: 'Category 6',
                  description: '',
                  scale: 5,
                  low_label: 'Strongly Disagree',
                  high_label: 'Strongly Agree',
                  has_na: true,
                  items: [
                    { id: 'el_1783557911567_ugpx', label: 'Participants discussed topics unrelated to the medical conversation.' },
                    { id: 'el_1783557915783_dl25', label: "Participants sought to establish rapport by asking questions about the other's personal life or work." },
                    { id: 'el_1783557919666_52n8', label: 'Participants engaged in conversation to get to know each other (outside of clinical roles).' },
                  ],
                  required: true,
                },
              ],
            },
            {
              id: 'el_1783372360930_dqp1',
              title: 'Section 7',
              description: '',
              elements: [
                {
                  id: 'el_1783372391677_9iez',
                  type: 'likert_group',
                  label: 'Category 7',
                  description: '',
                  scale: 5,
                  low_label: '',
                  high_label: '',
                  has_na: true,
                  items: [
                    { id: 'el_1783557930518_fu09', label: 'Participants indicated that certain issues could be discussed in the future to have adequate time.' },
                    { id: 'el_1783557934250_4hxa', label: 'To maintain a deliberate pace, some issues were held for another time.' },
                    { id: 'el_1783557941033_epwf', label: 'Participants prioritized a topic to allow for a more deliberate pace.' },
                  ],
                  required: true,
                },
              ],
            },
            {
              id: 'el_1783574935874_bprf',
              title: 'Overall Hurriedness',
              description: '',
              elements: [
                {
                  id: 'el_1783574958108_4aef',
                  type: 'likert',
                  label: 'Participants engaged in an unhurried conversation',
                  required: true,
                  has_na: false,
                  agreement_enabled: true,
                  agreement_weight: 1,
                  agreement_method: 'auto',
                  scale: 5,
                  low_label: 'Strongly Disagree',
                  high_label: 'Strongly Agree',
                },
              ],
            },
          ],
        },
      },
    ],
    mediaTypes: [
      {
        name: 'UCAT',
        reviews_required: 1,
        allow_custom_tags: 1,
        color: '#6366f1',
        tags: [],
        workspace_tabs: [
          { tab_type: 'form', ref_name: 'UCAT', label: 'UCAT', sort_order: 0 },
        ],
      },
    ],
  },
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function uniqueProjectName(db, baseName) {
  const existing = new Set(db.prepare('SELECT name FROM projects').all().map(row => row.name))
  if (!existing.has(baseName)) return baseName
  let i = 2
  while (existing.has(`${baseName} ${i}`)) i += 1
  return `${baseName} ${i}`
}

function listDefaultProjects() {
  return DEFAULT_PROJECTS.map(({ id, name, description }) => ({ id, name, description }))
}

function seedDefaultProject(db, templateId) {
  const template = DEFAULT_PROJECTS.find(project => project.id === templateId)
  if (!template) throw new Error('Default project template not found')

  const name = uniqueProjectName(db, template.name)
  const result = db.prepare('INSERT INTO projects (name, description) VALUES (?,?)')
    .run(name, template.description || '')
  const projectId = result.lastInsertRowid

  const formIdsByName = new Map()
  for (const form of template.forms || []) {
    const id = saveForm(db, projectId, { name: form.name, schema: clone(form.schema) })
    formIdsByName.set(form.name, id)
  }

  for (const mediaType of template.mediaTypes || []) {
    saveMediaType(db, projectId, {
      name: mediaType.name,
      reviews_required: mediaType.reviews_required ?? 1,
      allow_custom_tags: mediaType.allow_custom_tags ?? 1,
      color: mediaType.color || '#6366f1',
      tags: clone(mediaType.tags || []),
      workspace_tabs: (mediaType.workspace_tabs || []).map(tab => ({
        ...tab,
        ref_id: tab.ref_id || (tab.ref_name ? formIdsByName.get(tab.ref_name) : null),
      })).filter(tab => tab.tab_type !== 'form' || tab.ref_id),
    })
  }

  return { id: projectId, name, templateId }
}

module.exports = { listDefaultProjects, seedDefaultProject }
