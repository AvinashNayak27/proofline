import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { WorldSessionProvider } from '@/hooks/useWorldSession'
import { Admin } from '@/pages/Admin'
import { CampaignDetail } from '@/pages/CampaignDetail'
import { Campaigns } from '@/pages/Campaigns'
import { Create } from '@/pages/Create'
import { Dashboard } from '@/pages/Dashboard'
import { Landing } from '@/pages/Landing'
import { NotFound } from '@/pages/NotFound'
import { Rewards } from '@/pages/Rewards'

export default function App() {
  return (
    <WorldSessionProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Landing />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="campaigns/:id" element={<CampaignDetail />} />
            <Route path="create" element={<Create />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="rewards" element={<Rewards />} />
            <Route path="admin" element={<Admin />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WorldSessionProvider>
  )
}
