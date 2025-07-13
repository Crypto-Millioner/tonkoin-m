const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = {
    getUser: async (userId) => {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();
        return data;
    },

    saveUser: async (user) => {
        const { error } = await supabase
            .from('users')
            .upsert([user], { onConflict: 'id' });
        return !error;
    },

    updateUser: async (userId, updateFn) => {
        const user = await module.exports.getUser(userId);
        if (!user) return false;
        
        updateFn(user);
        const { error } = await supabase
            .from('users')
            .update(user)
            .eq('id', userId);
        return !error;
    },

    addReferral: async (inviterId, referralId) => {
        const { error } = await supabase
            .from('referrals')
            .insert([{ inviter_id: inviterId, referral_id: referralId }]);
        return !error;
    },

    getReferralsCount: async (inviterId) => {
        const { count, error } = await supabase
            .from('referrals')
            .select('*', { count: 'exact' })
            .eq('inviter_id', inviterId);
        return count || 0;
    },

    getTasks: async () => {
        const { data } = await supabase.from('tasks').select('*');
        return data || [];
    },

    addTask: async (task) => {
        const { error } = await supabase.from('tasks').insert([task]);
        return !error;
    },

    getAllUsers: async () => {
        const { data } = await supabase.from('users').select('*');
        return data || [];
    }
};