-- =====================================================================
-- NexusHub — RLS policies (CLAUDE.md §4.4 + ADR 0003)
--
-- Every workspace-scoped table follows the same template:
--   - SELECT: members of the workspace
--   - INSERT/UPDATE/DELETE: members of the workspace (Admin-only on
--     sensitive tables — invitations, integrations, audit_log).
--
-- Re-run after every prisma migrate: each block is idempotent (DROP IF
-- EXISTS before CREATE).
-- =====================================================================

-- ============================
-- workspaces
-- ============================
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspaces_member_read ON public.workspaces;
CREATE POLICY workspaces_member_read ON public.workspaces FOR SELECT
  USING (id IN (SELECT public.workspace_ids_for_current_user()));

DROP POLICY IF EXISTS workspaces_admin_write ON public.workspaces;
CREATE POLICY workspaces_admin_write ON public.workspaces FOR UPDATE
  USING (public.is_workspace_admin(id))
  WITH CHECK (public.is_workspace_admin(id));

-- workspaces are created by the service role only (admin signup flow)
DROP POLICY IF EXISTS workspaces_no_insert ON public.workspaces;
CREATE POLICY workspaces_no_insert ON public.workspaces FOR INSERT
  WITH CHECK (false);
DROP POLICY IF EXISTS workspaces_no_delete ON public.workspaces;
CREATE POLICY workspaces_no_delete ON public.workspaces FOR DELETE
  USING (false);

-- ============================
-- users (mirror of auth.users)
-- ============================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- A user can read users in workspaces they belong to + themselves.
DROP POLICY IF EXISTS users_read_visible ON public.users;
CREATE POLICY users_read_visible ON public.users FOR SELECT
  USING (
    id = auth.uid()
    OR id IN (
      SELECT m2.user_id
      FROM public.memberships m1
      JOIN public.memberships m2 ON m1.workspace_id = m2.workspace_id
      WHERE m1.user_id = auth.uid()
    )
  );

-- A user can update only their own profile.
DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- INSERT/DELETE done by trigger from auth.users — no client-side mutation.
DROP POLICY IF EXISTS users_no_insert ON public.users;
CREATE POLICY users_no_insert ON public.users FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS users_no_delete ON public.users;
CREATE POLICY users_no_delete ON public.users FOR DELETE USING (false);

-- ============================
-- memberships
-- ============================
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memberships_read ON public.memberships;
CREATE POLICY memberships_read ON public.memberships FOR SELECT
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

-- Only Admins can add / remove / change role.
DROP POLICY IF EXISTS memberships_admin_insert ON public.memberships;
CREATE POLICY memberships_admin_insert ON public.memberships FOR INSERT
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS memberships_admin_update ON public.memberships;
CREATE POLICY memberships_admin_update ON public.memberships FOR UPDATE
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS memberships_admin_delete ON public.memberships;
CREATE POLICY memberships_admin_delete ON public.memberships FOR DELETE
  USING (public.is_workspace_admin(workspace_id));

-- ============================
-- invitations (Admin-only)
-- ============================
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitations_admin_all ON public.invitations;
CREATE POLICY invitations_admin_all ON public.invitations FOR ALL
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- ============================
-- Generic helper macro (Postgres doesn't support real macros, so we
-- inline). The policies for member CRUD on standard tables are similar:
--   read/insert/update/delete restricted to workspace members.
-- ============================

-- clients
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clients_member_all ON public.clients;
CREATE POLICY clients_member_all ON public.clients FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

-- contacts
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_member_all ON public.contacts;
CREATE POLICY contacts_member_all ON public.contacts FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

-- client_channel_mappings
ALTER TABLE public.client_channel_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ccm_admin_write ON public.client_channel_mappings;
CREATE POLICY ccm_admin_write ON public.client_channel_mappings FOR ALL
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS ccm_member_read ON public.client_channel_mappings;
CREATE POLICY ccm_member_read ON public.client_channel_mappings FOR SELECT
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

-- project_types
ALTER TABLE public.project_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_types_member_all ON public.project_types;
CREATE POLICY project_types_member_all ON public.project_types FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

-- projects
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_member_all ON public.projects;
CREATE POLICY projects_member_all ON public.projects FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

-- project_members
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pm_member_all ON public.project_members;
CREATE POLICY pm_member_all ON public.project_members FOR ALL
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p
      WHERE p.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT p.id FROM public.projects p
      WHERE p.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  );

-- columns (scoped via project)
ALTER TABLE public.columns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS columns_member_all ON public.columns;
CREATE POLICY columns_member_all ON public.columns FOR ALL
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p
      WHERE p.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT p.id FROM public.projects p
      WHERE p.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  );

-- cards
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cards_member_all ON public.cards;
CREATE POLICY cards_member_all ON public.cards FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

-- card_assignees (scoped via card → workspace)
ALTER TABLE public.card_assignees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ca_member_all ON public.card_assignees;
CREATE POLICY ca_member_all ON public.card_assignees FOR ALL
  USING (
    card_id IN (
      SELECT c.id FROM public.cards c
      WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  )
  WITH CHECK (
    card_id IN (
      SELECT c.id FROM public.cards c
      WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  );

-- checklist_items
ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ci_member_all ON public.checklist_items;
CREATE POLICY ci_member_all ON public.checklist_items FOR ALL
  USING (
    card_id IN (
      SELECT c.id FROM public.cards c
      WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  )
  WITH CHECK (
    card_id IN (
      SELECT c.id FROM public.cards c
      WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  );

-- comments
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comments_read ON public.comments;
CREATE POLICY comments_read ON public.comments FOR SELECT
  USING (
    card_id IN (
      SELECT c.id FROM public.cards c
      WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  );

DROP POLICY IF EXISTS comments_insert_member ON public.comments;
CREATE POLICY comments_insert_member ON public.comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND card_id IN (
      SELECT c.id FROM public.cards c
      WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  );

DROP POLICY IF EXISTS comments_update_own ON public.comments;
CREATE POLICY comments_update_own ON public.comments FOR UPDATE
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS comments_delete_own ON public.comments;
CREATE POLICY comments_delete_own ON public.comments FOR DELETE
  USING (author_id = auth.uid());

-- email_templates
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_templates_member_all ON public.email_templates;
CREATE POLICY email_templates_member_all ON public.email_templates FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

-- kanban_templates
ALTER TABLE public.kanban_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kt_member_all ON public.kanban_templates;
CREATE POLICY kt_member_all ON public.kanban_templates FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

-- kanban_template_columns (scoped via template)
ALTER TABLE public.kanban_template_columns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ktc_member_all ON public.kanban_template_columns;
CREATE POLICY ktc_member_all ON public.kanban_template_columns FOR ALL
  USING (
    template_id IN (
      SELECT t.id FROM public.kanban_templates t
      WHERE t.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  )
  WITH CHECK (
    template_id IN (
      SELECT t.id FROM public.kanban_templates t
      WHERE t.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  );

-- ============================
-- integrations (Admin-only mutations; member can read non-secret fields)
-- ============================
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- SECURITY: encrypted_tokens column is column-level revoked from authenticated below.
DROP POLICY IF EXISTS integrations_member_read ON public.integrations;
CREATE POLICY integrations_member_read ON public.integrations FOR SELECT
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

DROP POLICY IF EXISTS integrations_admin_write ON public.integrations;
CREATE POLICY integrations_admin_write ON public.integrations FOR ALL
  USING (
    public.is_workspace_admin(workspace_id)
    OR (scope = 'user' AND owner_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR (scope = 'user' AND owner_user_id = auth.uid())
  );

-- Hide encrypted_tokens from authenticated role entirely (defense in depth).
-- service_role can still read it. Application uses service_role to decrypt.
REVOKE SELECT (encrypted_tokens) ON public.integrations FROM authenticated;
REVOKE SELECT (encrypted_tokens) ON public.integrations FROM anon;

-- ============================
-- oauth_states (service-role only — clients never touch this)
-- ============================
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_states_none ON public.oauth_states;
CREATE POLICY oauth_states_none ON public.oauth_states FOR ALL
  USING (false) WITH CHECK (false);

-- ============================
-- email_messages / slack_messages
-- ============================
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS em_member_all ON public.email_messages;
CREATE POLICY em_member_all ON public.email_messages FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

ALTER TABLE public.slack_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sm_member_all ON public.slack_messages;
CREATE POLICY sm_member_all ON public.slack_messages FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

-- ============================
-- notifications, push_subscriptions, notification_preferences (own only)
-- ============================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notif_self_read ON public.notifications;
CREATE POLICY notif_self_read ON public.notifications FOR SELECT
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS notif_self_update ON public.notifications;
CREATE POLICY notif_self_update ON public.notifications FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- INSERT done by service-role only.
DROP POLICY IF EXISTS notif_no_insert_authenticated ON public.notifications;
CREATE POLICY notif_no_insert_authenticated ON public.notifications FOR INSERT
  WITH CHECK (false);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_self_all ON public.push_subscriptions;
CREATE POLICY push_self_all ON public.push_subscriptions FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS np_self_all ON public.notification_preferences;
CREATE POLICY np_self_all ON public.notification_preferences FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================
-- activity_events (read-only for members; INSERT by service-role only)
-- ============================
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS activity_member_read ON public.activity_events;
CREATE POLICY activity_member_read ON public.activity_events FOR SELECT
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()));
DROP POLICY IF EXISTS activity_no_authenticated_write ON public.activity_events;
CREATE POLICY activity_no_authenticated_write ON public.activity_events FOR INSERT
  WITH CHECK (false);
DROP POLICY IF EXISTS activity_no_update ON public.activity_events;
CREATE POLICY activity_no_update ON public.activity_events FOR UPDATE USING (false);
DROP POLICY IF EXISTS activity_no_delete ON public.activity_events;
CREATE POLICY activity_no_delete ON public.activity_events FOR DELETE USING (false);

-- ============================
-- audit_log (append-only, service-role only)
-- ============================
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- Workspace admins can read; nobody else.
DROP POLICY IF EXISTS audit_admin_read ON public.audit_log;
CREATE POLICY audit_admin_read ON public.audit_log FOR SELECT
  USING (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS audit_no_authenticated_write ON public.audit_log;
CREATE POLICY audit_no_authenticated_write ON public.audit_log FOR INSERT
  WITH CHECK (false);
DROP POLICY IF EXISTS audit_no_update ON public.audit_log;
CREATE POLICY audit_no_update ON public.audit_log FOR UPDATE USING (false);
DROP POLICY IF EXISTS audit_no_delete ON public.audit_log;
CREATE POLICY audit_no_delete ON public.audit_log FOR DELETE USING (false);
