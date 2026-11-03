<script lang="ts">
    import { onMount } from "svelte";
    import { authClient } from "#lib/auth-client.js";
    import { browser } from "$app/env";
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { PUBLIC_GOOGLE_CLIENT_ID } from "$app/env/public";
    import { ArrowLeft, Fingerprint } from "@lucide/svelte";
    import { Heading } from "#lib/components/index.js";
    import { Cta, cn } from "#lib/ds/index.js";
    import { isPlatformAuthenticatorAvailable, detectPlatform, biometricLabel } from "#lib/ds/adapters/index.js";

    let isLoading = $state(false);
    let error = $state<string | null>(null);
    // Biometric sign-in needs a real platform authenticator; only show it when one exists.
    let webauthnAvailable = $state(false);
    let biometricName = $state("device biometrics");

    onMount(async () => {
        webauthnAvailable = await isPlatformAuthenticatorAvailable();
        biometricName = biometricLabel(detectPlatform());
    });

    // Preserve the originally requested route from ?redirect= so post-login lands the user there.
    const redirectUrl = $derived(page.url.searchParams.get("redirect") ?? "/");
    // One Tap only fires when a public Google client id is configured (see auth-client.ts).
    const oneTapConfigured = browser && !!PUBLIC_GOOGLE_CLIENT_ID;

    // Client-side fallback redirect: signIn.social() does a full OAuth round-trip,
    // but if a live session already exists (e.g. back-nav to /login) this bounces
    // out without waiting for the server load guard.
    const session = authClient.useSession();
    let oneTapTried = false;
    $effect(() => {
        if (!browser) return;
        if ($session.data?.user) {
            goto(redirectUrl);
            return;
        }
        // Auto-prompt Google One Tap once; on success the session effect redirects.
        if (oneTapConfigured && !oneTapTried) {
            oneTapTried = true;
            authClient.oneTap({ fetchOptions: { onSuccess: () => goto(redirectUrl) } }).catch(() => {});
        }
    });

    const handleGoogleLogin = async () => {
        isLoading = true;
        error = null;

        try {
            await authClient.signIn.social({
                provider: "google",
                callbackURL: redirectUrl
            });
        } catch (e) {
            error = "Failed to sign in with Google. Please try again.";
            console.error(e);
        } finally {
            isLoading = false;
        }
    };

    const handlePasskeyLogin = async () => {
        isLoading = true;
        error = null;
        try {
            const res = await authClient.signIn.passkey();
            if (res?.error) {
                error = `${biometricName} sign-in failed or was cancelled.`;
            } else {
                goto(redirectUrl);
            }
        } catch (e) {
            error = `${biometricName} sign-in failed. Please try again.`;
            console.error(e);
        } finally {
            isLoading = false;
        }
    };
</script>

<svelte:head>
    <title>Sign In - Shopify Order Processor</title>
</svelte:head>

<div class="flex grow flex-col items-center justify-center gap-8 overflow-hidden px-4 sm:gap-10 sm:px-6 lg:gap-12">
    <Heading />

    {#if error}
        <div
            class="border-hair bg-destructive/10 text-destructive max-w-sm rounded-xl border px-4 py-2.5 text-center text-sm text-pretty"
            role="alert"
        >
            {error}
        </div>
    {/if}

    <div class="flex flex-col items-center gap-3">
        <Cta
            variant="primary"
            arrow={false}
            onclick={handleGoogleLogin}
            disabled={isLoading}
            class={cn("min-w-[260px] justify-center py-4", isLoading && "cursor-wait")}
        >
            <span class="inline-flex items-center gap-2.5 whitespace-nowrap">
                {#if isLoading}
                    <span
                        class="border-background/40 size-4 animate-spin rounded-full border-2 border-t-transparent"
                        aria-hidden="true"
                    ></span>
                {:else}
                    <svg class="size-4" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        ></path>
                        <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        ></path>
                        <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        ></path>
                        <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        ></path>
                    </svg>
                {/if}
                <span>Continue with Google</span>
            </span>
        </Cta>

        {#if webauthnAvailable}
            <Cta
                variant="secondary"
                arrow={false}
                onclick={handlePasskeyLogin}
                disabled={isLoading}
                class={cn("min-w-[260px] justify-center py-4", isLoading && "cursor-wait")}
            >
                <span class="inline-flex items-center gap-2.5 whitespace-nowrap">
                    <Fingerprint class="size-4" aria-hidden="true" />
                    <span>Sign in with {biometricName}</span>
                </span>
            </Cta>
        {/if}
    </div>

    <Cta variant="secondary" href="/" arrow={false} class="mt-4 min-w-[260px] justify-center py-4 sm:mt-6">
        <span class="inline-flex items-center gap-2.5 whitespace-nowrap">
            <ArrowLeft
                class="size-4 transition-transform duration-300 ease-[var(--ease)] group-hover:-translate-x-0.5"
                strokeWidth={2.25}
                aria-hidden="true"
            />
            <span>Back to homepage</span>
        </span>
    </Cta>
</div>
