import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing required environment variables:')
  console.error('  NEXT_PUBLIC_SUPABASE_URL')
  console.error('  SUPABASE_SERVICE_ROLE_KEY')
  console.error('')
  console.error('Set them in .env.local or export them before running this script.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

function daysAgo(days: number): string {
  return hoursAgo(days * 24)
}

const DEFAULT_POLICIES = {
  ai_can_reorder_tasks: true,
  ai_can_reduce_scope: true,
  ai_can_change_goals: false,
  ai_can_drop_tasks: false,
  max_now_tasks: 3,
  escalation_drift_threshold: 0.7,
  escalation_failure_threshold: 3,
  min_check_in_interval_hours: 12,
  max_check_in_interval_hours: 72,
}

// ---------------------------------------------------------------------------
// User creation helper
// ---------------------------------------------------------------------------

interface UserSeed {
  email: string
  full_name: string
  role: 'coach' | 'client'
  password: string
}

async function createUserIfNotExists(user: UserSeed): Promise<string> {
  // Check if user already exists by listing users and filtering by email
  const { data: existingUsers, error: listError } =
    await supabase.auth.admin.listUsers()

  if (listError) {
    throw new Error(`Failed to list users: ${listError.message}`)
  }

  const existing = existingUsers.users.find((u) => u.email === user.email)
  if (existing) {
    console.log(`  User ${user.email} already exists (${existing.id})`)
    return existing.id
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: {
      full_name: user.full_name,
      role: user.role,
    },
  })

  if (error) {
    throw new Error(`Failed to create user ${user.email}: ${error.message}`)
  }

  console.log(`  Created user ${user.email} (${data.user.id})`)
  return data.user.id
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanExistingData() {
  console.log('Cleaning existing seed data...')

  // Delete in reverse dependency order
  const tables = [
    'escalations',
    'check_ins',
    'tasks',
    'plans',
    'cases',
  ] as const

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) {
      console.warn(`  Warning: could not clean ${table}: ${error.message}`)
    } else {
      console.log(`  Cleaned ${table}`)
    }
  }

  // Delete profiles (will cascade from auth users deletion)
  // We'll delete auth users for seed emails, which triggers cascade
  const seedEmails = [
    'coach@coachos.demo',
    'jane@coachos.demo',
    'mike@coachos.demo',
    'sara@coachos.demo',
    'alex.chen@coachos.demo',
    'priya@coachos.demo',
    'tom@coachos.demo',
  ]

  const { data: existingUsers } = await supabase.auth.admin.listUsers()
  if (existingUsers) {
    for (const user of existingUsers.users) {
      if (user.email && seedEmails.includes(user.email)) {
        // Delete profile first (the trigger creates it, but cascade should handle it)
        await supabase.from('profiles').delete().eq('id', user.id)
        const { error } = await supabase.auth.admin.deleteUser(user.id)
        if (error) {
          console.warn(`  Warning: could not delete user ${user.email}: ${error.message}`)
        } else {
          console.log(`  Deleted user ${user.email}`)
        }
      }
    }
  }

  console.log('Cleanup complete.\n')
}

// ---------------------------------------------------------------------------
// Main seed
// ---------------------------------------------------------------------------

async function seed() {
  console.log('=== CoachOS Seed Script ===\n')

  // ---------------------------
  // Step 0: Clean existing data
  // ---------------------------
  await cleanExistingData()

  // ---------------------------
  // Step 1: Create users
  // ---------------------------
  console.log('Step 1: Creating users...')

  const coachId = await createUserIfNotExists({
    email: 'coach@coachos.demo',
    full_name: 'Alex Rivera',
    role: 'coach',
    password: 'demo1234',
  })

  const janeId = await createUserIfNotExists({
    email: 'jane@coachos.demo',
    full_name: 'Jane Student',
    role: 'client',
    password: 'demo1234',
  })

  const mikeId = await createUserIfNotExists({
    email: 'mike@coachos.demo',
    full_name: 'Mike Johnson',
    role: 'client',
    password: 'demo1234',
  })

  const saraId = await createUserIfNotExists({
    email: 'sara@coachos.demo',
    full_name: 'Sara Williams',
    role: 'client',
    password: 'demo1234',
  })

  const alexChenId = await createUserIfNotExists({
    email: 'alex.chen@coachos.demo',
    full_name: 'Alex Chen',
    role: 'client',
    password: 'demo1234',
  })

  const priyaId = await createUserIfNotExists({
    email: 'priya@coachos.demo',
    full_name: 'Priya Patel',
    role: 'client',
    password: 'demo1234',
  })

  const tomId = await createUserIfNotExists({
    email: 'tom@coachos.demo',
    full_name: 'Tom Rivera',
    role: 'client',
    password: 'demo1234',
  })

  console.log('Users created.\n')

  // ---------------------------
  // Step 2: Create cases
  // ---------------------------
  console.log('Step 2: Creating cases...')

  // Jane Student — needs_review
  const { data: janeCase, error: janeCaseErr } = await supabase
    .from('cases')
    .insert({
      client_id: janeId,
      coach_id: coachId,
      status: 'active',
      drift_score: 0.8,
      overwhelm_score: 0.7,
      adherence_rate: 0.3,
      check_in_interval_hours: 12,
      last_check_in_at: hoursAgo(26),
      awaiting_check_in: true,
      policies: DEFAULT_POLICIES,
    })
    .select()
    .single()

  if (janeCaseErr) throw new Error(`Failed to create Jane's case: ${janeCaseErr.message}`)
  console.log(`  Created Jane's case: ${janeCase.id}`)

  // Mike Johnson — drifting
  const { data: mikeCase, error: mikeCaseErr } = await supabase
    .from('cases')
    .insert({
      client_id: mikeId,
      coach_id: coachId,
      status: 'active',
      drift_score: 0.52,
      overwhelm_score: 0.4,
      adherence_rate: 0.6,
      check_in_interval_hours: 24,
      last_check_in_at: hoursAgo(30),
      awaiting_check_in: false,
      policies: DEFAULT_POLICIES,
    })
    .select()
    .single()

  if (mikeCaseErr) throw new Error(`Failed to create Mike's case: ${mikeCaseErr.message}`)
  console.log(`  Created Mike's case: ${mikeCase.id}`)

  // Sara Williams — on_track
  const { data: saraCase, error: saraCaseErr } = await supabase
    .from('cases')
    .insert({
      client_id: saraId,
      coach_id: coachId,
      status: 'active',
      drift_score: 0.12,
      overwhelm_score: 0.15,
      adherence_rate: 0.92,
      check_in_interval_hours: 48,
      last_check_in_at: hoursAgo(10),
      awaiting_check_in: false,
      policies: DEFAULT_POLICIES,
    })
    .select()
    .single()

  if (saraCaseErr) throw new Error(`Failed to create Sara's case: ${saraCaseErr.message}`)
  console.log(`  Created Sara's case: ${saraCase.id}`)

  // Alex Chen — on_track
  const { data: alexCase, error: alexCaseErr } = await supabase
    .from('cases')
    .insert({
      client_id: alexChenId,
      coach_id: coachId,
      status: 'active',
      drift_score: 0.08,
      overwhelm_score: 0.1,
      adherence_rate: 0.95,
      check_in_interval_hours: 48,
      last_check_in_at: hoursAgo(6),
      awaiting_check_in: false,
      policies: DEFAULT_POLICIES,
    })
    .select()
    .single()

  if (alexCaseErr) throw new Error(`Failed to create Alex Chen's case: ${alexCaseErr.message}`)
  console.log(`  Created Alex Chen's case: ${alexCase.id}`)

  // Priya Patel — drifting
  const { data: priyaCase, error: priyaCaseErr } = await supabase
    .from('cases')
    .insert({
      client_id: priyaId,
      coach_id: coachId,
      status: 'active',
      drift_score: 0.45,
      overwhelm_score: 0.35,
      adherence_rate: 0.55,
      check_in_interval_hours: 24,
      last_check_in_at: hoursAgo(28),
      awaiting_check_in: false,
      policies: DEFAULT_POLICIES,
    })
    .select()
    .single()

  if (priyaCaseErr) throw new Error(`Failed to create Priya's case: ${priyaCaseErr.message}`)
  console.log(`  Created Priya's case: ${priyaCase.id}`)

  // Tom Rivera — inactive (no check-in in 5 days)
  const { data: tomCase, error: tomCaseErr } = await supabase
    .from('cases')
    .insert({
      client_id: tomId,
      coach_id: coachId,
      status: 'active',
      drift_score: 0.6,
      overwhelm_score: 0.3,
      adherence_rate: 0.2,
      check_in_interval_hours: 24,
      last_check_in_at: daysAgo(5),
      awaiting_check_in: true,
      policies: DEFAULT_POLICIES,
    })
    .select()
    .single()

  if (tomCaseErr) throw new Error(`Failed to create Tom's case: ${tomCaseErr.message}`)
  console.log(`  Created Tom's case: ${tomCase.id}`)

  console.log('Cases created.\n')

  // ---------------------------
  // Step 3: Create plans
  // ---------------------------
  console.log('Step 3: Creating plans...')

  // Jane's plan (version 4 — the active one; previous versions are archived)
  // Archived plans (v1-v3) to show history
  const { error: janePlanV1Err } = await supabase.from('plans').insert({
    case_id: janeCase.id,
    goals: [
      { id: 'goal-1', title: 'Pass midterm', description: 'Score above 70% on biology midterm', priority: 'high' },
      { id: 'goal-2', title: 'Get organized', description: 'Set up a consistent study routine', priority: 'medium' },
    ],
    weekly_focus: 'Start midterm preparation',
    version: 1,
    change_summary: 'Initial plan created from brain dump.',
    is_active: false,
    created_at: daysAgo(6),
    updated_at: daysAgo(6),
  })
  if (janePlanV1Err) console.warn(`  Warning: v1 plan: ${janePlanV1Err.message}`)

  const { error: janePlanV2Err } = await supabase.from('plans').insert({
    case_id: janeCase.id,
    goals: [
      { id: 'goal-1', title: 'Pass midterm', description: 'Score above 70% on biology midterm', priority: 'high' },
      { id: 'goal-2', title: 'Get organized', description: 'Set up a consistent study routine', priority: 'medium' },
    ],
    weekly_focus: 'Midterm prep — focus on biology',
    version: 2,
    change_summary: 'Reduced study task from 30min to 15min after first failure.',
    is_active: false,
    created_at: daysAgo(4),
    updated_at: daysAgo(4),
  })
  if (janePlanV2Err) console.warn(`  Warning: v2 plan: ${janePlanV2Err.message}`)

  const { error: janePlanV3Err } = await supabase.from('plans').insert({
    case_id: janeCase.id,
    goals: [
      { id: 'goal-1', title: 'Pass midterm', description: 'Score above 70% on biology midterm', priority: 'high' },
      { id: 'goal-2', title: 'Get organized', description: 'Set up a consistent study routine', priority: 'medium' },
    ],
    weekly_focus: 'Midterm prep — smaller steps',
    version: 3,
    change_summary: 'Reduced study task further to 10min. Increased check-in frequency to 12h.',
    is_active: false,
    created_at: daysAgo(3),
    updated_at: daysAgo(3),
  })
  if (janePlanV3Err) console.warn(`  Warning: v3 plan: ${janePlanV3Err.message}`)

  // Current active plan (v4)
  const { data: janePlan, error: janePlanErr } = await supabase
    .from('plans')
    .insert({
      case_id: janeCase.id,
      goals: [
        { id: 'goal-1', title: 'Pass midterm', description: 'Score above 70% on biology midterm', priority: 'high' },
        { id: 'goal-2', title: 'Get organized', description: 'Set up a consistent study routine', priority: 'medium' },
      ],
      weekly_focus: 'Midterm prep',
      version: 4,
      change_summary: 'Third failure on study task. Escalating to coach. Task reduced to reading chapter summary only (10 min).',
      is_active: true,
      created_at: hoursAgo(26),
      updated_at: hoursAgo(26),
    })
    .select()
    .single()

  if (janePlanErr) throw new Error(`Failed to create Jane's plan: ${janePlanErr.message}`)
  console.log(`  Created Jane's plan (v4): ${janePlan.id}`)

  // Mike's plan
  const { data: mikePlan, error: mikePlanErr } = await supabase
    .from('plans')
    .insert({
      case_id: mikeCase.id,
      goals: [
        { id: 'goal-1', title: 'Complete project report', description: 'Finish quarterly report by end of month', priority: 'high' },
      ],
      weekly_focus: 'Project report — first draft',
      version: 2,
      change_summary: 'Adjusted timeline after missed deadline on outline.',
      is_active: true,
    })
    .select()
    .single()

  if (mikePlanErr) throw new Error(`Failed to create Mike's plan: ${mikePlanErr.message}`)
  console.log(`  Created Mike's plan: ${mikePlan.id}`)

  // Sara's plan
  const { data: saraPlan, error: saraPlanErr } = await supabase
    .from('plans')
    .insert({
      case_id: saraCase.id,
      goals: [
        { id: 'goal-1', title: 'Learn Python basics', description: 'Complete online Python course modules 1-5', priority: 'high' },
        { id: 'goal-2', title: 'Build portfolio project', description: 'Create a simple web scraper', priority: 'medium' },
      ],
      weekly_focus: 'Python module 3 — functions and loops',
      version: 3,
      change_summary: 'Moving to module 3 after completing module 2 exercises.',
      is_active: true,
    })
    .select()
    .single()

  if (saraPlanErr) throw new Error(`Failed to create Sara's plan: ${saraPlanErr.message}`)
  console.log(`  Created Sara's plan: ${saraPlan.id}`)

  // Alex Chen's plan
  const { data: alexPlan, error: alexPlanErr } = await supabase
    .from('plans')
    .insert({
      case_id: alexCase.id,
      goals: [
        { id: 'goal-1', title: 'Prepare for job interviews', description: 'Practice coding problems and behavioral questions', priority: 'high' },
      ],
      weekly_focus: 'Leetcode medium problems — arrays and strings',
      version: 2,
      change_summary: 'On track. Advancing to medium difficulty.',
      is_active: true,
    })
    .select()
    .single()

  if (alexPlanErr) throw new Error(`Failed to create Alex Chen's plan: ${alexPlanErr.message}`)
  console.log(`  Created Alex Chen's plan: ${alexPlan.id}`)

  // Priya's plan
  const { data: priyaPlan, error: priyaPlanErr } = await supabase
    .from('plans')
    .insert({
      case_id: priyaCase.id,
      goals: [
        { id: 'goal-1', title: 'Finish thesis chapter 2', description: 'Literature review section', priority: 'high' },
        { id: 'goal-2', title: 'Submit conference abstract', description: 'Due in 3 weeks', priority: 'medium' },
      ],
      weekly_focus: 'Literature review — find 5 more sources',
      version: 2,
      change_summary: 'Reduced daily writing target from 500 to 300 words.',
      is_active: true,
    })
    .select()
    .single()

  if (priyaPlanErr) throw new Error(`Failed to create Priya's plan: ${priyaPlanErr.message}`)
  console.log(`  Created Priya's plan: ${priyaPlan.id}`)

  // Tom's plan
  const { data: tomPlan, error: tomPlanErr } = await supabase
    .from('plans')
    .insert({
      case_id: tomCase.id,
      goals: [
        { id: 'goal-1', title: 'Complete online certification', description: 'AWS Cloud Practitioner exam', priority: 'high' },
      ],
      weekly_focus: 'AWS core services module',
      version: 1,
      change_summary: 'Initial plan created.',
      is_active: true,
    })
    .select()
    .single()

  if (tomPlanErr) throw new Error(`Failed to create Tom's plan: ${tomPlanErr.message}`)
  console.log(`  Created Tom's plan: ${tomPlan.id}`)

  console.log('Plans created.\n')

  // ---------------------------
  // Step 4: Create tasks
  // ---------------------------
  console.log('Step 4: Creating tasks...')

  // Jane's tasks
  const { error: janeTask1Err } = await supabase.from('tasks').insert({
    case_id: janeCase.id,
    plan_id: janePlan.id,
    title: 'Study biology chapter 4',
    description: 'Read chapter 4 and complete practice questions. Midterm is next Tuesday.',
    status: 'stuck',
    priority_bucket: 'now',
    estimated_minutes: 10,
    failure_count: 3,
    order_index: 0,
    deadline: new Date('2026-03-03T00:00:00Z').toISOString(),
    created_at: daysAgo(6),
  })
  if (janeTask1Err) console.warn(`  Warning: Jane task 1: ${janeTask1Err.message}`)
  else console.log('  Created Jane task: Study biology chapter 4')

  const { error: janeTask2Err } = await supabase.from('tasks').insert({
    case_id: janeCase.id,
    plan_id: janePlan.id,
    title: 'Call the bank',
    description: 'Ask about student account fees',
    status: 'pending',
    priority_bucket: 'next',
    estimated_minutes: 15,
    failure_count: 0,
    order_index: 1,
    created_at: daysAgo(6),
  })
  if (janeTask2Err) console.warn(`  Warning: Jane task 2: ${janeTask2Err.message}`)
  else console.log('  Created Jane task: Call the bank')

  const { error: janeTask3Err } = await supabase.from('tasks').insert({
    case_id: janeCase.id,
    plan_id: janePlan.id,
    title: 'Clean room',
    description: 'Organize desk and bookshelf',
    status: 'done',
    priority_bucket: 'later',
    estimated_minutes: 30,
    failure_count: 0,
    order_index: 2,
    created_at: daysAgo(6),
    completed_at: daysAgo(4),
  })
  if (janeTask3Err) console.warn(`  Warning: Jane task 3: ${janeTask3Err.message}`)
  else console.log('  Created Jane task: Clean room (done)')

  // Mike's tasks
  const { error: mikeTask1Err } = await supabase.from('tasks').insert({
    case_id: mikeCase.id,
    plan_id: mikePlan.id,
    title: 'Write report outline',
    description: 'Draft section headers and key points for quarterly report',
    status: 'stuck',
    priority_bucket: 'now',
    estimated_minutes: 45,
    failure_count: 1,
    order_index: 0,
  })
  if (mikeTask1Err) console.warn(`  Warning: Mike task 1: ${mikeTask1Err.message}`)
  else console.log('  Created Mike task: Write report outline')

  const { error: mikeTask2Err } = await supabase.from('tasks').insert({
    case_id: mikeCase.id,
    plan_id: mikePlan.id,
    title: 'Gather Q4 data',
    description: 'Pull metrics from analytics dashboard',
    status: 'pending',
    priority_bucket: 'now',
    estimated_minutes: 20,
    failure_count: 0,
    order_index: 1,
  })
  if (mikeTask2Err) console.warn(`  Warning: Mike task 2: ${mikeTask2Err.message}`)
  else console.log('  Created Mike task: Gather Q4 data')

  // Sara's tasks
  const { error: saraTask1Err } = await supabase.from('tasks').insert({
    case_id: saraCase.id,
    plan_id: saraPlan.id,
    title: 'Complete Python functions exercise',
    description: 'Exercises 3.1 through 3.5 in the online course',
    status: 'active',
    priority_bucket: 'now',
    estimated_minutes: 25,
    failure_count: 0,
    order_index: 0,
  })
  if (saraTask1Err) console.warn(`  Warning: Sara task 1: ${saraTask1Err.message}`)
  else console.log('  Created Sara task: Complete Python functions exercise')

  const { error: saraTask2Err } = await supabase.from('tasks').insert({
    case_id: saraCase.id,
    plan_id: saraPlan.id,
    title: 'Watch loops tutorial video',
    description: 'Module 3 part 2 video lesson',
    status: 'pending',
    priority_bucket: 'next',
    estimated_minutes: 20,
    failure_count: 0,
    order_index: 1,
  })
  if (saraTask2Err) console.warn(`  Warning: Sara task 2: ${saraTask2Err.message}`)
  else console.log('  Created Sara task: Watch loops tutorial video')

  // Alex Chen's tasks
  const { error: alexTask1Err } = await supabase.from('tasks').insert({
    case_id: alexCase.id,
    plan_id: alexPlan.id,
    title: 'Solve 2 Leetcode medium problems',
    description: 'Focus on array manipulation and string parsing',
    status: 'active',
    priority_bucket: 'now',
    estimated_minutes: 40,
    failure_count: 0,
    order_index: 0,
  })
  if (alexTask1Err) console.warn(`  Warning: Alex Chen task 1: ${alexTask1Err.message}`)
  else console.log('  Created Alex Chen task: Solve 2 Leetcode medium problems')

  const { error: alexTask2Err } = await supabase.from('tasks').insert({
    case_id: alexCase.id,
    plan_id: alexPlan.id,
    title: 'Prepare STAR stories',
    description: 'Write 3 behavioral interview answers using STAR method',
    status: 'pending',
    priority_bucket: 'next',
    estimated_minutes: 30,
    failure_count: 0,
    order_index: 1,
  })
  if (alexTask2Err) console.warn(`  Warning: Alex Chen task 2: ${alexTask2Err.message}`)
  else console.log('  Created Alex Chen task: Prepare STAR stories')

  // Priya's tasks
  const { error: priyaTask1Err } = await supabase.from('tasks').insert({
    case_id: priyaCase.id,
    plan_id: priyaPlan.id,
    title: 'Write 300 words of literature review',
    description: 'Continue the methodology comparison section',
    status: 'pending',
    priority_bucket: 'now',
    estimated_minutes: 45,
    failure_count: 1,
    order_index: 0,
  })
  if (priyaTask1Err) console.warn(`  Warning: Priya task 1: ${priyaTask1Err.message}`)
  else console.log('  Created Priya task: Write 300 words of literature review')

  const { error: priyaTask2Err } = await supabase.from('tasks').insert({
    case_id: priyaCase.id,
    plan_id: priyaPlan.id,
    title: 'Search for 3 new journal sources',
    description: 'Use Google Scholar for recent papers on the topic',
    status: 'pending',
    priority_bucket: 'now',
    estimated_minutes: 25,
    failure_count: 0,
    order_index: 1,
  })
  if (priyaTask2Err) console.warn(`  Warning: Priya task 2: ${priyaTask2Err.message}`)
  else console.log('  Created Priya task: Search for 3 new journal sources')

  // Tom's tasks
  const { error: tomTask1Err } = await supabase.from('tasks').insert({
    case_id: tomCase.id,
    plan_id: tomPlan.id,
    title: 'Watch AWS EC2 lesson',
    description: 'Core services module — EC2 fundamentals',
    status: 'pending',
    priority_bucket: 'now',
    estimated_minutes: 30,
    failure_count: 0,
    order_index: 0,
  })
  if (tomTask1Err) console.warn(`  Warning: Tom task 1: ${tomTask1Err.message}`)
  else console.log('  Created Tom task: Watch AWS EC2 lesson')

  const { error: tomTask2Err } = await supabase.from('tasks').insert({
    case_id: tomCase.id,
    plan_id: tomPlan.id,
    title: 'Complete S3 practice lab',
    description: 'Hands-on lab for S3 bucket configuration',
    status: 'pending',
    priority_bucket: 'next',
    estimated_minutes: 40,
    failure_count: 0,
    order_index: 1,
  })
  if (tomTask2Err) console.warn(`  Warning: Tom task 2: ${tomTask2Err.message}`)
  else console.log('  Created Tom task: Complete S3 practice lab')

  console.log('Tasks created.\n')

  // ---------------------------
  // Step 5: Create Jane's check-ins (5 over 4 days, showing progressive failure)
  // ---------------------------
  console.log("Step 5: Creating Jane's check-ins...")

  // Check-in 1 (4 days ago): Completed the room cleaning task — positive
  const { error: ci1Err } = await supabase.from('check_ins').insert({
    case_id: janeCase.id,
    completed_top_action: true,
    blocker: null,
    free_text: 'Cleaned my desk and bookshelf. Feeling a bit better about things.',
    ai_parsed_signals: {
      sentiment: 'positive',
      overwhelm_level: 0.2,
      avoidance_detected: false,
      blocker_category: 'none',
      notable_context: null,
    },
    created_at: daysAgo(4),
  })
  if (ci1Err) console.warn(`  Warning: Check-in 1: ${ci1Err.message}`)
  else console.log('  Created check-in 1 (4 days ago): completed, positive')

  // Check-in 2 (3.5 days ago): Did not complete biology study (30min version) — first failure
  const { error: ci2Err } = await supabase.from('check_ins').insert({
    case_id: janeCase.id,
    completed_top_action: false,
    blocker: 'Too big',
    free_text: "I opened the textbook but the chapter is really long. I didn't know where to start.",
    ai_parsed_signals: {
      sentiment: 'stressed',
      overwhelm_level: 0.5,
      avoidance_detected: true,
      blocker_category: 'task_too_big',
      notable_context: "Client felt overwhelmed by chapter length. Didn't know where to begin.",
    },
    created_at: hoursAgo(84),
  })
  if (ci2Err) console.warn(`  Warning: Check-in 2: ${ci2Err.message}`)
  else console.log('  Created check-in 2 (3.5 days ago): failed, task too big')

  // Check-in 3 (2.5 days ago): Did not complete biology study (15min version) — second failure
  const { error: ci3Err } = await supabase.from('check_ins').insert({
    case_id: janeCase.id,
    completed_top_action: false,
    blocker: 'Too big',
    free_text: 'I tried but even 15 minutes feels like a lot right now. I keep staring at the page.',
    ai_parsed_signals: {
      sentiment: 'stressed',
      overwhelm_level: 0.6,
      avoidance_detected: true,
      blocker_category: 'task_too_big',
      notable_context: 'Repeated avoidance pattern. Client describes difficulty focusing.',
    },
    created_at: hoursAgo(60),
  })
  if (ci3Err) console.warn(`  Warning: Check-in 3: ${ci3Err.message}`)
  else console.log('  Created check-in 3 (2.5 days ago): failed again, still too big')

  // Check-in 4 (1.5 days ago): Did not complete biology study (10min version) — third failure
  const { error: ci4Err } = await supabase.from('check_ins').insert({
    case_id: janeCase.id,
    completed_top_action: false,
    blocker: "Didn't want to",
    free_text:
      "I just can't make myself do it. I don't even know why. I haven't been sleeping well and everything feels like too much.",
    ai_parsed_signals: {
      sentiment: 'overwhelmed',
      overwhelm_level: 0.8,
      avoidance_detected: true,
      blocker_category: 'low_motivation',
      notable_context: 'Mentioned sleep issues. Language suggests broader overwhelm beyond this specific task.',
    },
    created_at: hoursAgo(36),
  })
  if (ci4Err) console.warn(`  Warning: Check-in 4: ${ci4Err.message}`)
  else console.log('  Created check-in 4 (1.5 days ago): third failure, overwhelmed, sleep issues')

  // Check-in 5 (26 hours ago): Did not complete — still stuck, increasing distress
  const { error: ci5Err } = await supabase.from('check_ins').insert({
    case_id: janeCase.id,
    completed_top_action: false,
    blocker: "Didn't want to",
    free_text:
      "The midterm is in 4 days and I haven't done anything. I feel like I'm going to fail. I don't know what to do.",
    ai_parsed_signals: {
      sentiment: 'overwhelmed',
      overwhelm_level: 0.9,
      avoidance_detected: true,
      blocker_category: 'low_motivation',
      notable_context: 'Escalating distress. Client expressing hopelessness about midterm outcome. Urgent attention needed.',
    },
    created_at: hoursAgo(26),
  })
  if (ci5Err) console.warn(`  Warning: Check-in 5: ${ci5Err.message}`)
  else console.log('  Created check-in 5 (26 hours ago): continued failure, escalating distress')

  // Additional check-ins for other clients to make the dashboard feel alive

  // Mike — 1 recent check-in
  const { error: mikeCi1Err } = await supabase.from('check_ins').insert({
    case_id: mikeCase.id,
    completed_top_action: false,
    blocker: 'No time',
    free_text: 'Had back-to-back meetings all day. Will try tomorrow morning.',
    ai_parsed_signals: {
      sentiment: 'neutral',
      overwhelm_level: 0.3,
      avoidance_detected: false,
      blocker_category: 'no_time',
      notable_context: null,
    },
    created_at: hoursAgo(30),
  })
  if (mikeCi1Err) console.warn(`  Warning: Mike check-in: ${mikeCi1Err.message}`)

  // Sara — 1 recent check-in
  const { error: saraCi1Err } = await supabase.from('check_ins').insert({
    case_id: saraCase.id,
    completed_top_action: true,
    blocker: null,
    free_text: 'Finished the exercises! Functions are starting to click.',
    ai_parsed_signals: {
      sentiment: 'positive',
      overwhelm_level: 0.1,
      avoidance_detected: false,
      blocker_category: 'none',
      notable_context: 'Client showing confidence growth in the subject.',
    },
    created_at: hoursAgo(10),
  })
  if (saraCi1Err) console.warn(`  Warning: Sara check-in: ${saraCi1Err.message}`)

  // Alex Chen — 1 recent check-in
  const { error: alexCi1Err } = await supabase.from('check_ins').insert({
    case_id: alexCase.id,
    completed_top_action: true,
    blocker: null,
    free_text: 'Solved both problems. The two-pointer technique is really useful.',
    ai_parsed_signals: {
      sentiment: 'positive',
      overwhelm_level: 0.05,
      avoidance_detected: false,
      blocker_category: 'none',
      notable_context: null,
    },
    created_at: hoursAgo(6),
  })
  if (alexCi1Err) console.warn(`  Warning: Alex Chen check-in: ${alexCi1Err.message}`)

  console.log('Check-ins created.\n')

  // ---------------------------
  // Step 6: Create Jane's escalation
  // ---------------------------
  console.log("Step 6: Creating Jane's escalation...")

  const { data: janeEscalation, error: janeEscErr } = await supabase
    .from('escalations')
    .insert({
      case_id: janeCase.id,
      trigger_reason: "Task 'Study biology chapter 4' failed 3 times",
      ai_summary:
        'Jane has attempted the biology study task three times over 4 days. Each time she reported it felt "too big." ' +
        'The system reduced the task from 30 minutes to 15 minutes to 10 minutes, but Jane continued to report being unable to start. ' +
        'Her most recent check-ins show escalating language — she mentioned not sleeping well, feeling like "everything is too much," ' +
        'and expressed fear of failing the midterm. The pattern suggests the blocker is not task size but a broader overwhelm or avoidance pattern ' +
        'that the AI system cannot resolve through scope reduction alone. The midterm is in 4 days.',
      what_ai_tried: [
        'Reduced study task from 30 minutes to 15 minutes',
        'Reduced study task further to 10 minutes (read chapter summary only)',
        'Increased check-in frequency from 24h to 12h',
        'Moved non-essential tasks (call bank) to next bucket to reduce visible load',
        'Simplified weekly focus to single priority',
      ],
      ai_recommendations: [
        {
          action: 'Schedule a 15-minute call to understand what is really blocking Jane',
          rationale:
            'Repeated "too big" responses despite aggressive scope reduction suggests the real issue is not task size. ' +
            'A direct conversation may reveal anxiety, external stressors, or a need to rethink the goal entirely.',
        },
        {
          action: 'Consider pausing the midterm goal and addressing overwhelm first',
          rationale:
            'Overwhelm score is 0.9 and rising. Continuing to push on the midterm task may increase avoidance. ' +
            'A temporary pause could reduce pressure and allow Jane to re-engage on her own terms.',
        },
        {
          action: 'Explore whether sleep issues are affecting her capacity',
          rationale:
            'Jane mentioned not sleeping well. Sleep disruption significantly impacts executive function and motivation. ' +
            'This may be a root cause worth addressing before academic tasks.',
        },
      ],
      urgency: 'urgent',
      coach_action: null,
      coach_notes: null,
      created_at: hoursAgo(26),
      resolved_at: null,
    })
    .select()
    .single()

  if (janeEscErr) throw new Error(`Failed to create Jane's escalation: ${janeEscErr.message}`)
  console.log(`  Created Jane's escalation: ${janeEscalation.id}`)

  console.log('Escalation created.\n')

  // ---------------------------
  // Done
  // ---------------------------
  console.log('=== Seed complete! ===\n')
  console.log('Demo accounts:')
  console.log('  Coach:  coach@coachos.demo / demo1234')
  console.log('  Client: jane@coachos.demo  / demo1234 (needs_review, has escalation)')
  console.log('  Client: mike@coachos.demo  / demo1234 (drifting)')
  console.log('  Client: sara@coachos.demo  / demo1234 (on_track)')
  console.log('  Client: alex.chen@coachos.demo / demo1234 (on_track)')
  console.log('  Client: priya@coachos.demo / demo1234 (drifting)')
  console.log('  Client: tom@coachos.demo   / demo1234 (inactive)')
  console.log('')
  console.log('Run with: npm run seed')
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
