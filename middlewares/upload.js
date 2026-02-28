const multer = require('multer');

const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (!file.mimetype) return cb(new Error('Invalid file'), false);

  const ok = file.mimetype.indexOf('image/') === 0;
  if (!ok) return cb(new Error('Only image files are allowed'), false);

  cb(null, true);
}

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

module.exports = upload;
