#!/usr/bin/env node

/**
 * TEST DE UPLOAD - Simula exactamente lo que hace el frontend
 * 
 * Esto nos dirá EXACTAMENTE en qué punto falla el upload.
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// Configuración
const API_URL = process.env.API_URL || 'https://art-language-backend.railway.app/api';
const TOKEN = process.argv[2]; // Pasar token como argumento

if (!TOKEN) {
  console.error('❌ Uso: node test-upload.js <JWT_TOKEN>');
  console.error('   Obtén el token desde localStorage en el navegador');
  process.exit(1);
}

// Crear un PDF de prueba simple
const testPDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000056 00000 n\n0000000114 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF');

async function testUpload() {
  console.log('🧪 INICIANDO TEST DE UPLOAD\n');
  console.log('API URL:', API_URL);
  console.log('Token length:', TOKEN.length);
  console.log('');

  // Paso 1: Crear FormData exactamente como lo hace el frontend
  console.log('📦 PASO 1: Crear FormData');
  const fd = new FormData();
  fd.append('file', testPDF, {
    filename: 'test.pdf',
    contentType: 'application/pdf'
  });
  fd.append('title', 'Test Upload - ' + new Date().toISOString());
  fd.append('description', 'Test automático');
  fd.append('subject', 'Testing');
  fd.append('gradeLevel', '1st Grade');
  console.log('✅ FormData creado');
  console.log('');

  // Paso 2: Hacer POST exactamente como lo hace worksheetAPI.upload()
  console.log('📤 PASO 2: POST a /worksheets/upload');
  
  try {
    const response = await axios.post(`${API_URL}/worksheets/upload`, fd, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        ...fd.getHeaders() // Esto es crítico - incluye el boundary
      }
    });

    console.log('✅ UPLOAD EXITOSO\n');
    console.log('Status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    
    // Verificar que tenga la estructura esperada
    if (response.data.success && response.data.data && response.data.data.worksheet) {
      console.log('\n✅ Estructura de respuesta válida');
      console.log('Worksheet ID:', response.data.data.worksheet.id);
      console.log('Workbook ID:', response.data.data.worksheet.workbookId);
    } else {
      console.log('\n⚠️  Respuesta tiene estructura inesperada');
    }

  } catch (error) {
    console.log('❌ UPLOAD FALLÓ\n');
    
    if (error.response) {
      // El servidor respondió con status fuera de rango 2xx
      console.log('Status:', error.response.status);
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
      console.log('\n🔍 DIAGNÓSTICO:');
      console.log('El servidor devolvió un error. Esto es lo que el frontend vería:');
      console.log('  err.response?.data?.message =', error.response.data?.message);
    } else if (error.request) {
      // La request se hizo pero no hubo respuesta
      console.log('❌ No hubo respuesta del servidor');
      console.log('Request enviado pero timeout o error de red');
    } else {
      // Error al configurar la request
      console.log('❌ Error al configurar la request:', error.message);
    }
    
    console.log('\nStack trace completo:');
    console.log(error.stack);
  }
}

testUpload();
