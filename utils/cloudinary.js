let cloudinary = require('cloudinary').v2;
let streamifier = require('streamifier');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

function uploadBuffer(buffer, folderName) {
  return new Promise(function (resolve, reject) {
    let stream = cloudinary.uploader.upload_stream(
      {
        folder: folderName || 'leadsyncflow_profiles',
        resource_type: 'image'
      },
      function (error, result) {
        if (error) {
          console.log('✅ Cloudinary upload error (raw):', error);
          console.log('✅ Cloudinary upload error message:', error.message);
          return reject(error);
        }
        resolve(result);
      }
    );

    try {
      streamifier.createReadStream(buffer).pipe(stream);
    } catch (e) {
      console.log('✅ Streamifier error:', e);
      reject(e);
    }
  });
}

module.exports = {
  uploadBuffer: uploadBuffer
};
