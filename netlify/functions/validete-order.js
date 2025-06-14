// netlify/functions/validate-order.js
// App Shopify privée - Validation quantité vs photos UploadKit

const crypto = require('crypto');

// Configuration - MODIFIEZ CES VALEURS
const CONFIG = {
  PRODUCT_NAME: 'tirage', // Nom du produit à valider
  ADMIN_EMAIL: 'nicolas.makeitperfect@email.com', // Email pour notifications
  SHOPIFY_WEBHOOK_SECRET: process.env.SHOPIFY_WEBHOOK_SECRET,
  SHOPIFY_ACCESS_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN,
  SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN // ex: monstore.myshopify.com
};

exports.handler = async (event, context) => {
  console.log('🚀 Webhook reçu:', event.httpMethod);

  // Vérification méthode POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  try {
    // Vérification signature Shopify (sécurité)
    const signature = event.headers['x-shopify-hmac-sha256'];
    const body = event.body;
    
    if (!verifyShopifyWebhook(body, signature)) {
      console.log('❌ Signature webhook invalide');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Signature invalide' })
      };
    }

    // Parse des données de commande
    const order = JSON.parse(body);
    console.log('📦 Commande reçue:', order.order_number);

    // Validation des line items
    const validationResult = await validateOrder(order);
    
    if (!validationResult.isValid) {
      console.log('🚨 Commande invalide détectée:', validationResult.reason);
      
      // Annulation de la commande
      await cancelOrder(order.id, validationResult.reason);
      
      // Notification admin
      await notifyAdmin(order, validationResult.reason);
      
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

// Fonction de validation principale
async function validateOrder(order) {
  const invalidItems = [];

  for (const lineItem of order.line_items) {
    // Vérifier si c'est le produit à valider
    if (lineItem.title.toLowerCase().includes(CONFIG.PRODUCT_NAME.toLowerCase())) {
      console.log(`🔍 Validation de: ${lineItem.title}`);
      
      // Compter les photos dans les propriétés
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

// Compter les photos UploadKit dans les propriétés
function countUploadedPhotos(properties) {
  if (!properties || !Array.isArray(properties)) {
    return 0;
  }

  let photoCount = 0;
  
  properties.forEach(prop => {
    // Détecter les propriétés UploadKit contenant des photos
    if (prop.name && prop.name.toLowerCase().includes('photo') && 
        prop.value && (prop.value.includes('uploadkit') || prop.value.includes('cdn'))) {
      photoCount++;
    }
  });

  console.log(`📸 ${photoCount} photos détectées dans les propriétés`);
  return photoCount;
}

// Annuler la commande via API Shopify
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

// Notification admin par email (simulation)
async function notifyAdmin(order, reason) {
  // Pour une vraie implémentation, utilisez SendGrid, Mailgun, etc.
  console.log(`📧 Notification admin: Commande ${order.order_number} annulée - ${reason}`);
  
  // Exemple avec fetch vers un service email externe
  // await fetch('https://api.emailservice.com/send', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({
  //     to: CONFIG.ADMIN_EMAIL,
  //     subject: `🚨 Commande frauduleuse détectée - ${order.order_number}`,
  //     text: `Commande annulée automatiquement.\nRaison: ${reason}\nMontant: ${order.total_price} €`
  //   })
  // });
}

// Vérification signature webhook Shopify
function verifyShopifyWebhook(body, signature) {
  if (!CONFIG.SHOPIFY_WEBHOOK_SECRET || !signature) {
    console.log('⚠️ Pas de secret webhook configuré');
    return true; // En développement, on peut bypasser
  }

  const hmac = crypto.createHmac('sha256', CONFIG.SHOPIFY_WEBHOOK_SECRET);
  hmac.update(body, 'utf8');
  const hash = hmac.digest('base64');

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}