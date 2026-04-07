/** Supabase client — singleton for auth and data operations. */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_PUBLISHABLE_KEY__: string;

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
    if (!_supabase) {
        _supabase = createClient(
            __SUPABASE_URL__ || import.meta.env.VITE_SUPABASE_URL || '',
            __SUPABASE_PUBLISHABLE_KEY__ || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
        );
    }
    return _supabase;
}
