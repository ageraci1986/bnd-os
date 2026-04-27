-- ============================================================
-- RLS helpers (used by every policy below)
-- NOTE: search_path is pinned in migration 004 (advisor fix).
-- ============================================================
CREATE OR REPLACE FUNCTION public.workspace_ids_for_current_user()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT m.workspace_id
  FROM public.memberships m
  WHERE m.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = auth.uid()
      AND m.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.workspace_ids_for_current_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_workspace_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_ids_for_current_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid) TO authenticated;

-- ============================================================
-- workspaces
-- ============================================================
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspaces_member_read ON public.workspaces FOR SELECT
  USING (id IN (SELECT public.workspace_ids_for_current_user()));

CREATE POLICY workspaces_admin_update ON public.workspaces FOR UPDATE
  USING (public.is_workspace_admin(id))
  WITH CHECK (public.is_workspace_admin(id));

CREATE POLICY workspaces_no_insert ON public.workspaces FOR INSERT WITH CHECK (false);
CREATE POLICY workspaces_no_delete ON public.workspaces FOR DELETE USING (false);

-- ============================================================
-- users (mirror of auth.users)
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY users_update_self ON public.users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY users_no_insert ON public.users FOR INSERT WITH CHECK (false);
CREATE POLICY users_no_delete ON public.users FOR DELETE USING (false);

-- ============================================================
-- memberships (Admin-only mutations)
-- ============================================================
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY memberships_read ON public.memberships FOR SELECT
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

CREATE POLICY memberships_admin_insert ON public.memberships FOR INSERT
  WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY memberships_admin_update ON public.memberships FOR UPDATE
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY memberships_admin_delete ON public.memberships FOR DELETE
  USING (public.is_workspace_admin(workspace_id));

-- ============================================================
-- invitations (Admin-only)
-- ============================================================
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitations_admin_all ON public.invitations FOR ALL
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

-- ============================================================
-- clients / contacts / channel mappings
-- ============================================================
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY clients_member_all ON public.clients FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY contacts_member_all ON public.contacts FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

ALTER TABLE public.client_channel_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ccm_member_read ON public.client_channel_mappings FOR SELECT
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()));
CREATE POLICY ccm_admin_insert ON public.client_channel_mappings FOR INSERT
  WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY ccm_admin_update ON public.client_channel_mappings FOR UPDATE
  USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));
CREATE POLICY ccm_admin_delete ON public.client_channel_mappings FOR DELETE
  USING (public.is_workspace_admin(workspace_id));

-- ============================================================
-- project_types / projects / project_members
-- ============================================================
ALTER TABLE public.project_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_types_member_all ON public.project_types FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_member_all ON public.projects FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY pm_member_all ON public.project_members FOR ALL
  USING (project_id IN (
    SELECT p.id FROM public.projects p
    WHERE p.workspace_id IN (SELECT public.workspace_ids_for_current_user())
  ))
  WITH CHECK (project_id IN (
    SELECT p.id FROM public.projects p
    WHERE p.workspace_id IN (SELECT public.workspace_ids_for_current_user())
  ));

-- ============================================================
-- columns / cards / card_assignees / checklist_items / comments
-- ============================================================
ALTER TABLE public.columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY columns_member_all ON public.columns FOR ALL
  USING (project_id IN (
    SELECT p.id FROM public.projects p
    WHERE p.workspace_id IN (SELECT public.workspace_ids_for_current_user())
  ))
  WITH CHECK (project_id IN (
    SELECT p.id FROM public.projects p
    WHERE p.workspace_id IN (SELECT public.workspace_ids_for_current_user())
  ));

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY cards_member_all ON public.cards FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

ALTER TABLE public.card_assignees ENABLE ROW LEVEL SECURITY;
CREATE POLICY ca_member_all ON public.card_assignees FOR ALL
  USING (card_id IN (
    SELECT c.id FROM public.cards c
    WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
  ))
  WITH CHECK (card_id IN (
    SELECT c.id FROM public.cards c
    WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
  ));

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY ci_member_all ON public.checklist_items FOR ALL
  USING (card_id IN (
    SELECT c.id FROM public.cards c
    WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
  ))
  WITH CHECK (card_id IN (
    SELECT c.id FROM public.cards c
    WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
  ));

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY comments_read ON public.comments FOR SELECT
  USING (card_id IN (
    SELECT c.id FROM public.cards c
    WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
  ));
CREATE POLICY comments_insert_member ON public.comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND card_id IN (
      SELECT c.id FROM public.cards c
      WHERE c.workspace_id IN (SELECT public.workspace_ids_for_current_user())
    )
  );
CREATE POLICY comments_update_own ON public.comments FOR UPDATE
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());
CREATE POLICY comments_delete_own ON public.comments FOR DELETE
  USING (author_id = auth.uid());

-- ============================================================
-- templates
-- ============================================================
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_templates_member_all ON public.email_templates FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

ALTER TABLE public.kanban_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY kt_member_all ON public.kanban_templates FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

ALTER TABLE public.kanban_template_columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY ktc_member_all ON public.kanban_template_columns FOR ALL
  USING (template_id IN (
    SELECT t.id FROM public.kanban_templates t
    WHERE t.workspace_id IN (SELECT public.workspace_ids_for_current_user())
  ))
  WITH CHECK (template_id IN (
    SELECT t.id FROM public.kanban_templates t
    WHERE t.workspace_id IN (SELECT public.workspace_ids_for_current_user())
  ));

-- ============================================================
-- integrations (encrypted_tokens column hidden from auth roles)
-- ============================================================
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY integrations_member_read ON public.integrations FOR SELECT
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

CREATE POLICY integrations_admin_or_self ON public.integrations FOR ALL
  USING (
    public.is_workspace_admin(workspace_id)
    OR (scope = 'user' AND owner_user_id = auth.uid())
  )
  WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR (scope = 'user' AND owner_user_id = auth.uid())
  );

-- Hide encrypted_tokens from authenticated/anon (defense in depth)
REVOKE SELECT (encrypted_tokens) ON public.integrations FROM authenticated;
REVOKE SELECT (encrypted_tokens) ON public.integrations FROM anon;

-- ============================================================
-- oauth_states (service-role only)
-- ============================================================
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY oauth_states_none ON public.oauth_states FOR ALL
  USING (false) WITH CHECK (false);

-- ============================================================
-- email_messages / slack_messages
-- ============================================================
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY em_member_all ON public.email_messages FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

ALTER TABLE public.slack_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY sm_member_all ON public.slack_messages FOR ALL
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()))
  WITH CHECK (workspace_id IN (SELECT public.workspace_ids_for_current_user()));

-- ============================================================
-- notifications / push_subscriptions / notification_preferences
-- ============================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_self_read ON public.notifications FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY notif_self_update ON public.notifications FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY notif_no_insert_authenticated ON public.notifications FOR INSERT
  WITH CHECK (false);
CREATE POLICY notif_no_delete ON public.notifications FOR DELETE USING (false);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_self_all ON public.push_subscriptions FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY np_self_all ON public.notification_preferences FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- activity_events (read for members; INSERT/UPDATE/DELETE service-role only)
-- ============================================================
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_member_read ON public.activity_events FOR SELECT
  USING (workspace_id IN (SELECT public.workspace_ids_for_current_user()));
CREATE POLICY activity_no_authenticated_write ON public.activity_events FOR INSERT
  WITH CHECK (false);
CREATE POLICY activity_no_update ON public.activity_events FOR UPDATE USING (false);
CREATE POLICY activity_no_delete ON public.activity_events FOR DELETE USING (false);

-- ============================================================
-- audit_log (Admin read; INSERT only by service-role)
-- ============================================================
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_admin_read ON public.audit_log FOR SELECT
  USING (workspace_id IS NOT NULL AND public.is_workspace_admin(workspace_id));
CREATE POLICY audit_no_authenticated_write ON public.audit_log FOR INSERT
  WITH CHECK (false);
CREATE POLICY audit_no_update ON public.audit_log FOR UPDATE USING (false);
CREATE POLICY audit_no_delete ON public.audit_log FOR DELETE USING (false);
