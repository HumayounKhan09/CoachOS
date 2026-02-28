import CoachLayoutClient from './CoachLayoutClient'

export const dynamic = 'force-dynamic'

export default function CoachLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <CoachLayoutClient>{children}</CoachLayoutClient>
}
