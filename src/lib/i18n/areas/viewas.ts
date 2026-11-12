// "View as": a steward previews the family as a role, a member or a guest of the share link (src/lib/auth/view-as.server.ts):
// the bar, the chooser, the entries on the Access page and in the account menu, and the server's refusals.
export const en = {
  // What a change gets during a preview (the server's sentences; every one ends the same way).
  "viewas.err_viewer": "You are viewing as a viewer. Stop the preview to change something.",
  "viewas.err_contributor": "You are viewing as a contributor. Stop the preview to change something.",
  "viewas.err_editor": "You are viewing as an editor. Stop the preview to change something.",
  "viewas.err_guest": "You are viewing as a guest. Stop the preview to change something.",
  "viewas.err_member": "You are viewing as {name}. Stop the preview to change something.",
  "viewas.err_not_steward": "Only a steward of this family can view it as someone else.",
  "viewas.err_no_member": "They are no longer a member of this family.",
  "viewas.err_self": "You already see the family as yourself.",
  "viewas.err_demo": "A demo has no previews: everyone sees it as a viewer.",
  "viewas.err_failed": "The preview could not start. Please try again.",
  "viewas.err_stop_failed": "The preview could not be stopped. Please try again.",
  "viewas.notice_title": "Not saved: this is a preview",

  // The bar on every page while a preview is on.
  "viewas.bar_label": "Preview",
  "viewas.as_viewer": "Viewing as a viewer",
  "viewas.as_contributor": "Viewing as a contributor",
  "viewas.as_editor": "Viewing as an editor",
  "viewas.as_member": "Viewing as {name}",
  "viewas.as_guest": "Viewing as a guest of the share link",
  "viewas.as_plain_guest": "Viewing as a guest",
  "viewas.bar_role": "Role: {role}",
  "viewas.bar_guest_role": "Guest, reads like a viewer",
  "viewas.bar_protected": "Living people protected",
  "viewas.bar_unprotected": "Living people shown in full",
  "viewas.bar_family": "In {family}",
  "viewas.bar_saved": "Nothing you do here is saved.",
  "viewas.switch": "Switch…",
  "viewas.stop": "Stop",
  "viewas.stop_aria": "Stop the preview and see the family as yourself",
  "viewas.started": "Preview on. {who}. Nothing you do here is saved.",
  "viewas.stopped": "Preview stopped. You see the family as yourself again.",

  // The chooser.
  "viewas.menu": "View as…",
  "viewas.title": "View the family as someone else",
  "viewas.intro": "See {family} exactly as another reader gets it. You stay signed in as yourself, and nothing you do during the preview is saved.",
  "viewas.role_heading": "A role",
  "viewas.role_hint": "A member with that role who is not linked to anyone in the tree.",
  "viewas.member_heading": "A member",
  "viewas.member_hint": "Their role and who they are in the tree. What is theirs alone (answers, reactions, private notes, chats) is not shown.",
  "viewas.no_members": "Nobody else is a member yet.",
  "viewas.member_unlinked": "Not linked to anyone in the tree",
  "viewas.member_linked": "Linked to {name}",
  "viewas.guest_heading": "A guest",
  "viewas.guest_link": "A guest of the share link",
  "viewas.guest_link_protected": "With the link’s settings: living people are protected.",
  "viewas.guest_link_open": "With the link’s settings: living people are shown in full.",
  "viewas.guest_plain": "A guest with living people protected",
  "viewas.guest_plain_hint": "The family has no open share link, so this is a guest with the safest setting.",
  "viewas.current": "Now",
  "viewas.loading": "Loading the family’s members…",
  "viewas.load_failed": "The members could not be loaded.",

  // The Access page.
  "viewas.access_heading": "See it as someone else",
  "viewas.access_text": "Check what a role, a member or a guest of the share link gets, without borrowing their phone.",
  "viewas.access_member": "View as",
  "viewas.access_member_aria": "View as {name}",
  "viewas.access_guest": "View as a guest of this link",

  // "Ask to join" during a guest's preview.
  "viewas.join_preview": "This is a preview: a guest of this link would be asked here whether they want an account of their own. Nothing is sent from a preview.",
} as const;
