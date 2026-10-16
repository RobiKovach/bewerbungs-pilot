const mode = process.argv[2] ?? 'ok';
if (mode === 'ok') { console.log('added 1 package'); process.exit(0); }
if (mode === 'fail') { console.error('npm ERR! code E404'); process.exit(1); }
if (mode === 'hang') setInterval(() => {}, 1000);
