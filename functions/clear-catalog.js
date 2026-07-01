/**
 * Temporary script: Clear old cardCatalog collection
 * Run once via: firebase functions:shell then clearCardCatalog()
 * Or execute directly: node -r @babel/register clear-catalog.js
 */
const admin = require('firebase-admin');

// Initialize if needed
if (!admin.apps.length) {
    admin.initializeApp();
}

async function clearCardCatalog() {
    const db = admin.firestore();
    const collection = db.collection('cardCatalog');
    const batch = db.batch();
    let count = 0;

    console.log('Starting cardCatalog deletion...');

    try {
        const snapshot = await collection.get();
        console.log(`Found ${snapshot.size} documents to delete`);

        snapshot.forEach((doc) => {
            batch.delete(doc.ref);
            count++;
        });

        if (count > 0) {
            await batch.commit();
            console.log(`✅ Deleted ${count} documents from cardCatalog`);
        } else {
            console.log('No documents found to delete');
        }
    } catch (error) {
        console.error('Error clearing cardCatalog:', error);
    }

    process.exit(0);
}

clearCardCatalog();
