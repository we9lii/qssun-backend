const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
// Use the Service Role Key for backend operations to bypass RLS for uploads.
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5aXFiZHJ5dWd4bHN1Zm5kcmhuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTIyNTQzOSwiZXhwIjoyMDc0ODAxNDM5fQ.b8wfiIadf7gWuwD0f6mmQkIEzvIu5i1FmAQe5nPIpmA';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Supabase URL and Service Key are required. Make sure they are in your .env file.');
  // In a real scenario, you might want to exit the process
  // process.exit(1); 
}

// Initialize the client with the Service Role key
const supabase = createClient(supabaseUrl, supabaseServiceKey);

module.exports = { supabase };