const admin = require('./firebaseAdmin').admin; // Ensure we get the initialized admin object
const db = require('./db.js');

/**
 * Saves or updates a user's FCM token in the database.
 * @param {string} userId The ID of the user.
 * @param {string} token The FCM token from the device.
 */
async function saveTokenToDatabase(userId, token) {
    try {
        const [existing] = await db.query(
            'SELECT id FROM fcm_tokens WHERE user_id = ? AND token = ?',
            [userId, token]
        );

        if (existing.length === 0) {
            await db.query(
                'INSERT INTO fcm_tokens (user_id, token) VALUES (?, ?)',
                [userId, token]
            );
            console.log(`New FCM token saved for user ${userId}`);
        } else {
            await db.query(
                'UPDATE fcm_tokens SET updated_at = NOW() WHERE id = ?',
                [existing[0].id]
            );
            console.log(`FCM token for user ${userId} timestamp updated.`);
        }
    } catch (error) {
        console.error(`Error saving FCM token for user ${userId}:`, error);
        throw error;
    }
}

/**
 * Sends a push notification to a specific user.
 * @param {string} userId The ID of the user to notify.
 * @param {string} title The title of the notification.
 * @param {string} body The body text of the notification.
 * @param {object} data The data payload to send with the notification (e.g., for navigation).
 */
async function sendPushNotification(userId, title, body, data = {}) {
    try {
        const [rows] = await db.query('SELECT token FROM fcm_tokens WHERE user_id = ?', [userId]);
        
        if (rows.length === 0) {
            console.log(`No FCM tokens found for user ${userId}. Skipping push notification.`);
            return;
        }

        const tokens = rows.map(row => row.token);

        const message = {
            notification: { title, body },
            data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' }, // Standard field for Capacitor
            tokens: tokens,
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        
        console.log(`Push notification sent to user ${userId}. Success: ${response.successCount}, Failure: ${response.failureCount}`);

        if (response.failureCount > 0) {
            const failures = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failures.push(handleFailedToken(tokens[idx], resp.error));
                }
            });
            await Promise.all(failures);
        }

    } catch (error) {
        console.error(`Error sending push notification to user ${userId}:`, error);
    }
}

async function handleFailedToken(token, error) {
    console.warn(`Failed to send to token: ${token}`, error.message);
    const invalidTokenCodes = [
        'messaging/invalid-registration-token',
        'messaging/registration-token-not-registered'
    ];
    if (invalidTokenCodes.includes(error.code)) {
        try {
            await db.query('DELETE FROM fcm_tokens WHERE token = ?', [token]);
            console.log(`Removed invalid FCM token: ${token}`);
        } catch (dbError) {
            console.error(`Error removing invalid FCM token ${token}:`, dbError);
        }
    }
}

module.exports = {
    saveTokenToDatabase,
    sendPushNotification,
};