const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
// Use the Service Role Key for backend operations to bypass RLS for uploads.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY; 

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Supabase URL and Service Key are required. Make sure they are in your .env file.');
  // In a real scenario, you might want to exit the process
  // process.exit(1); 
}

// Initialize the client with the Service Role key
const supabase = createClient(supabaseUrl, supabaseServiceKey);

module.exports = { supabase };