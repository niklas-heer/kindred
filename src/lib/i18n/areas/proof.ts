// Confirming with a passkey before adding another passkey or signing out everywhere else (src/lib/auth/proof.server.ts).
export const en = {
  "proof.needed": "Confirm it’s you with your passkey first.",
  "proof.hint": "Adding a passkey or signing out everywhere else asks for your passkey again, unless you signed in a few minutes ago.",
} as const;

export const de = {
  "proof.needed": "Bestätige zuerst mit deinem Passkey, dass du es bist.",
  "proof.hint": "Wenn du einen Passkey hinzufügst oder dich überall sonst abmeldest, fragt Kindred noch einmal nach deinem Passkey, außer du hast dich vor wenigen Minuten angemeldet.",
} as const;

export const af = {
  "proof.needed": "Bevestig eers met jou passkey dat dit jy is.",
  "proof.hint": "As jy ’n passkey byvoeg of oral elders afmeld, vra Kindred weer vir jou passkey, tensy jy ’n paar minute gelede aangemeld het.",
} as const;
