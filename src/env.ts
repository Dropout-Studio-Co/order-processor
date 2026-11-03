import { defineEnvVars } from "@sveltejs/kit/env";

// Public, non-secret Google OAuth client id for One Tap. An unset value is a
// supported configuration (One Tap stays off; the OAuth button and passkeys
// still work), so the schema falls back to the empty string instead of throwing.
export const variables = defineEnvVars({
    PUBLIC_GOOGLE_CLIENT_ID: { public: true, schema: (input) => input ?? "" }
});
