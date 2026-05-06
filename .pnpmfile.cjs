module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'better-sqlite3') {
        pkg.scripts = pkg.scripts || {};
        pkg.scripts.install = 'node-gyp rebuild';
      }
      return pkg;
    }
  }
};
