#!/usr/bin/env node
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const https = require('https');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

/**
 * Скачивает файл по URL и сохраняет его.
 * @param {string} url - Прямая ссылка на файл.
 * @returns {Promise<string>} - Возвращает путь к сохранённому файлу.
 */
function downloadFile(url) {
    return new Promise((resolve, reject) => {
        const fileName = path.basename(url);
        const fileStream = fs.createWriteStream(fileName);

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Download error: ${response.statusCode}`));
                return;
            }

            response.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                resolve(fileName);
            });

            fileStream.on('error', (err) => {
                reject(err);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Распаковывает ZIP-архив
 * @param {string} zipFile - Путь к ZIP-файлу
 * @param {string} extractTo - Папка для распаковки
 */
async function extractZip(zipFile, extractTo) {
    try {
        const zip = new AdmZip(zipFile);
        zip.extractAllTo(extractTo, true);
        console.log(`Extracted to: ${extractTo}`);
    } catch (error) {
        console.error('Extract error:', error);
        throw error;
    }
}

/**
 * Читает package.json
 * @returns {object} - Содержимое package.json или пустой объект
 */
function readPackageJson() {
    try {
        if (fs.existsSync('package.json')) {
            const data = fs.readFileSync('package.json', 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error reading package.json:', error.message);
    }
    return {};
}

/**
 * Сохраняет package.json
 * @param {object} pkg - Объект package.json
 */
function savePackageJson(pkg) {
    try {
        fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
        console.log('package.json updated');
    } catch (error) {
        console.error('Error saving package.json:', error.message);
    }
}

/**
 * Добавляет пакет в package.json
 * @param {string} pkg - Имя пакета
 */
function addToPackageJson(pkg) {
    const pkgJson = readPackageJson();
    
    // Если package.json не существует, пропускаем
    if (Object.keys(pkgJson).length === 0) {
        console.log('package.json not found, skipping dependency addition');
        return;
    }

    // Создаем секцию dependencies если её нет
    if (!pkgJson.dependencies) {
        pkgJson.dependencies = {};
    }

    // Добавляем пакет с версией latest
    pkgJson.dependencies[pkg] = 'latest';
    
    savePackageJson(pkgJson);
}

/**
 * Устанавливает пакет
 * @param {string} pkg - Имя пакета
 * @param {boolean} saveToPackageJson - Добавлять ли в package.json
 */
async function installPackage(pkg, saveToPackageJson = false) {
    try {
        const url = `https://raw.githubusercontent.com/ThisPeople/ppm_repo/refs/heads/main/${pkg}.zip`;
        const extractTo = `node_modules/${pkg.split('@')[0]}`;

        console.log(`Downloading ${pkg}...`);
        const filePath = await downloadFile(url);
        
        console.log(`Extracting ${pkg}...`);
        await extractZip(filePath, extractTo);
        
        // Удаляем временный ZIP-файл
        fs.rmSync(filePath);
        
        // Добавляем в package.json если нужно
        if (saveToPackageJson) {
            addToPackageJson(pkg);
        }
        
        console.log(`Package ${pkg} installed successfully`);
    } catch (error) {
        console.error(`Install failed: ${error.message}`);
        throw error;
    }
}

/**
 * Устанавливает все пакеты из package.json
 */
async function installAllPackages() {
    try {
        const pkgJson = readPackageJson();
        
        // Если package.json не существует или нет зависимостей
        if (Object.keys(pkgJson).length === 0 || !pkgJson.dependencies) {
            console.log('No dependencies found in package.json');
            return;
        }

        const packages = Object.keys(pkgJson.dependencies);
        
        if (packages.length === 0) {
            console.log('No dependencies found in package.json');
            return;
        }

        console.log(`Installing ${packages.length} package(s)...`);
        
        for (const pkg of packages) {
            await installPackage(pkg, false);
        }
        
        console.log('All packages installed successfully');
    } catch (error) {
        console.error(`Install all failed: ${error.message}`);
        throw error;
    }
}

/**
 * Удаляет пакет
 * @param {string} pkg - Имя пакета
 */
function removePackage(pkg) {
    try {
        const packageName = pkg.split('@')[0];
        const packagePath = `node_modules/${packageName}`;
        
        if (fs.existsSync(packagePath)) {
            fs.rmSync(packagePath, { recursive: true, force: true });
            console.log(`Package ${packageName} removed successfully`);
            
            // Удаляем из package.json
            const pkgJson = readPackageJson();
            if (pkgJson.dependencies && pkgJson.dependencies[packageName]) {
                delete pkgJson.dependencies[packageName];
                savePackageJson(pkgJson);
            }
        } else {
            console.log(`Package ${packageName} not found`);
        }
    } catch (error) {
        console.error(`Remove failed: ${error.message}`);
        throw error;
    }
}

/**
 * Обновляет пакет (переустанавливает)
 * @param {string} pkg - Имя пакета
 */
async function updatePackage(pkg) {
    try {
        const packageName = pkg.split('@')[0];
        console.log(`Updating ${packageName}...`);
        
        // Сначала удаляем
        removePackage(pkg);
        
        // Потом устанавливаем заново (сохраняем в package.json)
        await installPackage(pkg, true);
        
        console.log(`Package ${packageName} updated successfully`);
    } catch (error) {
        console.error(`Update failed: ${error.message}`);
        throw error;
    }
}

yargs(hideBin(process.argv))
    .scriptName('ppm')
    .usage('$0 <command> [package]')
    
    // install без аргументов - ставит всё из package.json
    // install <package> - ставит конкретный пакет
    .command(['install [package]', 'i [package]'], 'Install package(s)', (yargs) => {
        yargs
            .positional('package', {
                describe: 'Package name (optional, installs all from package.json if omitted)',
                type: 'string'
            })
            .option('save', {
                alias: 'S',
                type: 'boolean',
                description: 'Save to package.json dependencies'
            })
            .option('save-dev', {
                alias: 'D',
                type: 'boolean',
                description: 'Save to package.json devDependencies'
            });
    }, async (argv) => {
        try {
            if (argv.package) {
                // Установка конкретного пакета
                console.log(`Installing package: ${argv.package}`);
                await installPackage(argv.package, argv.save || argv.saveDev);
                console.log('Done');
            } else {
                // Установка всех пакетов из package.json
                console.log('Installing all packages from package.json...');
                await installAllPackages();
                console.log('Done');
            }
        } catch (error) {
            console.error('Installation failed:', error.message);
            process.exit(1);
        }
    })
    
    .command('remove <package>', 'Remove package', (yargs) => {
        yargs
            .positional('package', {
                describe: 'Package name',
                type: 'string'
            })
            .option('global', {
                alias: 'g',
                type: 'boolean',
                description: 'Global removal'
            });
    }, (argv) => {
        try {
            console.log(`Removing package: ${argv.package}`);
            removePackage(argv.package);
            console.log('Done');
        } catch (error) {
            console.error('Removal failed:', error.message);
            process.exit(1);
        }
    })
    
    .command('update <package>', 'Update package', (yargs) => {
        yargs
            .positional('package', {
                describe: 'Package name',
                type: 'string'
            });
    }, async (argv) => {
        try {
            console.log(`Updating package: ${argv.package}`);
            await updatePackage(argv.package);
            console.log('Done');
        } catch (error) {
            console.error('Update failed:', error.message);
            process.exit(1);
        }
    })
    
    .demandCommand(1, 'Specify command: install, remove, or update')
    .help()
    .argv;