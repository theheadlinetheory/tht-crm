// SUPABASE CLIENT — single shared instance (one GoTrue client only).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=20260724075901';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
