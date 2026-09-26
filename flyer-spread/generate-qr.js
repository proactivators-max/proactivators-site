const QRCode = require('qrcode');

const opts = {
  type: 'png',
  width: 900,
  margin: 1,
  color: {
    dark:  '#050505',
    light: '#f0ebe0'
  },
  errorCorrectionLevel: 'H'
};

(async () => {
  await QRCode.toFile('qr-workshop.png', 'https://proactivatorsclub.com/workshop/live/', opts);
  console.log('qr-workshop.png written');

  await QRCode.toFile('qr-speak.png', 'https://proactivatorsclub.com/lets-talk/', opts);
  console.log('qr-speak.png written');
})();
