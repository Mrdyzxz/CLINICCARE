
const SUPABASE_URL = "https://wowlsjzbsyrzfracxuor.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_gwxEsR-naBgbmj3ZnZBbDQ_RVEiqVOB";

if (!window.clinicSupabase) {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
        throw new Error("Supabase JS v2 failed to load.");
    }

    const { createClient } = window.supabase;

    const authStorage = {
        async getItem(key) {
            return window.localStorage.getItem(key) ??
                window.sessionStorage.getItem(key);
        },
        async setItem(key, value) {
            const rememberMe = document.getElementById("rememberMe");
            const storage = rememberMe && rememberMe.checked
                ? window.localStorage
                : window.sessionStorage;
            const otherStorage = storage === window.localStorage
                ? window.sessionStorage
                : window.localStorage;

            otherStorage.removeItem(key);
            storage.setItem(key, value);
        },
        async removeItem(key) {
            window.localStorage.removeItem(key);
            window.sessionStorage.removeItem(key);
        }
    };

    window.clinicSupabase = createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
        {
            auth: {
                storage: authStorage
            }
        }
    );

    console.info("CLINICCARE Supabase client initialized.");
} else {
    console.info("CLINICCARE Supabase client already initialized.");
}
