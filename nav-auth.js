// nav-auth.js — Shared navigation and authentication logic

import { supabase } from "./supabase-init.js";

/**
 * Robust sign out function
 */
window.navSignOut = async () => {
    try {
        if (supabase) {
            await supabase.auth.signOut();
        }
    } catch (e) {
        console.error("Sign out error:", e);
    } finally {
        // Always redirect or reload to clear state
        if (window.location.pathname.includes("game.html") || 
            window.location.pathname.includes("account.html")) {
            window.location.href = "index.html";
        } else {
            window.location.reload();
        }
    }
};

/**
 * Shared dropdown UI logic
 */
window.positionDropdown = () => {
    const btn = document.getElementById('nav-user-btn');
    const dd  = document.getElementById('nav-dropdown');
    if (!btn || !dd) return;

    const rect = btn.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.left = rect.left + rect.width / 2 + 'px';
    dd.style.top = rect.bottom + 'px';
    dd.style.transform = 'translateX(-50%)';
};

window.toggleDropdown = () => {
    const btn = document.getElementById('nav-user-btn');
    const dd  = document.getElementById('nav-dropdown');
    if (!btn || !dd) return;

    btn.classList.toggle('open');
    dd.classList.toggle('open');

    if (dd.classList.contains('open')) {
        window.positionDropdown();
    }
};

// Close dropdown on outside click
document.addEventListener('click', e => {
    const btn = document.getElementById('nav-user-btn');
    const dd  = document.getElementById('nav-dropdown');
    if (btn && !btn.contains(e.target) && dd && !dd.contains(e.target)) {
        btn.classList.remove('open');
        dd.classList.remove('open');
    }
});

// Update positioning on resize
window.addEventListener('resize', () => {
    const dd = document.getElementById('nav-dropdown');
    if (dd && dd.classList.contains('open')) {
        window.positionDropdown();
    }
});

/**
 * Shared Auth UI updates
 */
export function initNavAuth(callbacks = {}) {
    if (!supabase) return;

    // Helper to process session
    const handleSession = async (user, session, event) => {
        const loginBtn    = document.getElementById('nav-login-btn-link');
        const userBtn     = document.getElementById('nav-user-btn');
        const userNameEl  = document.getElementById('nav-user-name');
        const mobileLogin = document.getElementById('mobile-login-link');
        const mobileUser  = document.getElementById('mobile-user-link');

        if (user) {
            const name = user.user_metadata?.full_name || user.email.split('@')[0];
            if (loginBtn)    loginBtn.style.display = 'none';
            if (userBtn)     { userBtn.style.display = 'inline-flex'; if (userNameEl) userNameEl.textContent = name; }
            if (mobileLogin) mobileLogin.style.display = 'none';
            if (mobileUser)  { mobileUser.style.display = ''; mobileUser.textContent = name; }

            try {
                const { data } = await supabase.from('profiles').select('photo_url').eq('id', user.id).single();
                const photoURL = data?.photo_url || user.user_metadata?.avatar_url;
                updateNavAvatar(photoURL, name);
            } catch (e) {
                updateNavAvatar(user.user_metadata?.avatar_url, name);
            }
        } else {
            if (loginBtn)    loginBtn.style.display = 'inline-flex';
            if (userBtn)     userBtn.style.display = 'none';
            if (mobileLogin) mobileLogin.style.display = '';
            if (mobileUser)  mobileUser.style.display = 'none';
        }

        if (callbacks.onAuthStateChange) {
            callbacks.onAuthStateChange(event, session);
        }
    };

    // 1. Immediately check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
        handleSession(session?.user, session, 'INITIAL_SESSION');
    });

    // 2. Listen for future changes
    supabase.auth.onAuthStateChange((event, session) => {
        handleSession(session?.user, session, event);
    });
}

function updateNavAvatar(photoURL, name) {
    const el = document.getElementById('nav-user-initials');
    if (!el) return;
    if (photoURL) {
        el.innerHTML = `<img src="${photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
        el.textContent = name ? name.charAt(0).toUpperCase() : '?';
    }
}
