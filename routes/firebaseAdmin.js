const admin = require('firebase-admin');

function initializeFirebase() {
    if (admin.apps.length > 0) {
        return;
    }

    try {
        const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        if (!serviceAccountKey) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set or empty.');
        }

        const serviceAccount = JSON.parse(serviceAccountKey);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });

        console.log('✅ Firebase Admin SDK initialized successfully.');

    } catch (error) {
        console.error('❌ Firebase Admin SDK initialization failed:', error.message);
        // We throw the error to stop the server if Firebase is critical.
        throw error; 
    }
}

module.exports = {
    initializeFirebase,
    admin // Export the initialized admin object
};