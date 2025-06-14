const crypto = require('crypto');

// Import fetch pour Node.js
const fetch = require('node-fetch');

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

  let photoCount = 0;
  
  properties.forEach(prop => {
    if (prop.name && prop.name.toLowerCase().includes('photo') && 
        prop.value && (prop.value.includes('uploadkit') || prop.value.includes('cdn'))) {
      photoCount++;
    }
  });

  console.log(`📸 ${photoCount} photos détectées dans les propriétés`);
  return photoCount;
}

async function cancelOrder(orderId, reason) {
  try {
    const response = await fetch(`https://${CONFIG.SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/orders/${orderId}/cancel.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': CONFIG.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: 0,
        currency: 'EUR',
        reason: 'fraud',
        email: true,
        refund: true
      })
    });

    if (response.ok) {
      console.log('✅ Commande annulée avec succès');
    } else {
      console.error('❌ Erreur annulation:', await response.text());
    }
  } catch (error) {
    console.error('💥 Erreur lors de l\'annulation:', error);
  }
}
