const crypto = require('crypto');
const https = require('https');

const CONFIG = {
  PRODUCT_NAME: 'tirage',
  ADMIN_EMAIL: 'votre@email.com',
  SHOPIFY_WEBHOOK_SECRET: process.env.SHOPIFY_WEBHOOK_SECRET,
  SHOPIFY_ACCESS_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN,
  SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN
};

exports.handler = async (event, context) => {
  console.log('🚀 Webhook reçu:', event.httpMethod);

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  try {
    const order = JSON.parse(event.body);
    console.log('📦 Commande reçue:', order.order_number);

    const validationResult = await validateOrder(order);
    
    if (!validationResult.isValid) {
      console.log('🚨 Commande invalide détectée:', validationResult.reason);
      
      await cancelOrder(order.id, validationResult.reason);
      
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Commande annulée',
          reason: validationResult.reason 
        })
      };
    }

    console.log('✅ Commande valide:', order.order_number);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Commande valide' })
    };

  } catch (error) {
    console.error('💥 Erreur:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erreur interne' })
    };
  }
};

async function validateOrder(order) {
  const invalidItems = [];

  for (const lineItem of order.line_items) {
    if (lineItem.title.toLowerCase().includes(CONFIG.PRODUCT_NAME.toLowerCase())) {
      console.log(`🔍 Validation de: ${lineItem.title}`);
      
      const photoCount = countUploadedPhotos(lineItem.properties);
      const orderedQuantity = lineItem.quantity;
      
      console.log(`📊 Photos uploadées: ${photoCount}, Quantité commandée: ${orderedQuantity}`);
      
      if (photoCount !== orderedQuantity) {
        invalidItems.push({
          title: lineItem.title,
          photoCount,
          orderedQuantity,
          difference: Math.abs(photoCount - orderedQuantity)
        });
      }
    }
  }

  if (invalidItems.length > 0) {
    return {
      isValid: false,
      reason: `Quantité incorrecte détectée. Photos: ${invalidItems[0].photoCount}, Commandé: ${invalidItems[0].orderedQuantity}`,
      invalidItems
    };
  }

  return { isValid: true };
}

function countUploadedPhotos(properties) {
  if (!properties || !Array.isArray(properties)) {
    return 0;
  }

  // Compter seulement les propriétés uniques (éviter doublons thumbnail/original)
  const uniquePhotos = new Set();
  
  properties.forEach(prop => {
    if (prop.name && prop.name.toLowerCase().includes('photo') && 
        prop.value && (prop.value.includes('uploadkit') || prop.value.includes('cdn'))) {
      
      // Extraire un identifiant unique de l'URL pour éviter les doublons
      const photoId = prop.name.match(/\d+/) || prop.value.match(/([a-f0-9-]{36})/);
      if (photoId) {
        uniquePhotos.add(photoId[0]);
      }
    }
  });

  const photoCount = uniquePhotos.size;
  console.log(`📸 ${photoCount} photos uniques détectées dans les propriétés`);
  return photoCount;
}

async function cancelOrder(orderId, reason) {
  try {
    const url = `https://${CONFIG.SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/orders/${orderId}/cancel.json`;
    
    // Utilisation de https natif Node.js au lieu de fetch
    const postData = JSON.stringify({
      amount: 0,
      currency: 'EUR',
      reason: 'fraud',
      email: true,
      refund: true
    });

    const options = {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': CONFIG.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('✅ Commande annulée avec succès');
            resolve(true);
          } else {
            console.error('❌ Erreur annulation:', res.statusCode, data);
            resolve(false);
          }
        });
      });

      req.on('error', (error) => {
        console.error('💥 Erreur lors de l\'annulation:', error);
        resolve(false);
      });

      req.write(postData);
      req.end();
    });

  } catch (error) {
    console.error('💥 Erreur lors de l\'annulation:', error);
    return false;
  }
}
