import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project values.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type ProfileRole = "admin" | "requester";
export type ProfileStatus = "active" | "rejected";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  organization: string | null;
  country: string;
  role: ProfileRole;
  status: ProfileStatus;
  trusted: boolean;
  created_at: string;
}
