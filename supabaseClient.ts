import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // Use SERVICE_ROLE_KEY para escrita

export const supabase = createClient(supabaseUrl, supabaseKey);
