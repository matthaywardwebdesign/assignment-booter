/**
 * Assignment Booter
 * Author: Matt Hayward (matt@pipelabs.com.au)
 *
 * Usage: yarn start <directory inside assignments folder>
 * Alternate Usage: yarn start <zip file inside assignments folder>
 *
 * This will go ahead and find all package.json files (not inside node_modules)
 * and install dependencies for each of them, using pnpm (with offline preference)
 *
 * Following this it will boot each project using either the start or dev script
 * that is defined in the package.json file.
 *
 * Logs will be printed to both the console and a log file per project in the logs directory.
 *
 * The working directory and the logs directory will be cleared and recreated each time this script is run.
 */
const signale = require("signale");
const path = require("path");
const unzipper = require("unzipper");
const fs = require("fs");
const Walk = require("@root/walk");
const shell_exec = require("child_process").execSync;
const spawn = require("child_process").spawn;

const WORKING_DIRECTORY = path.resolve(__dirname, "assignments", "working");
const LOGS_DIRECTORY = path.resolve(__dirname, "logs");

async function run() {
  /* Ensure that we have a directory that we wish to install and boot */
  const directory = process.argv[2];

  if (!directory) {
    signale.error(
      "Please provide a directory or zip file path to install and boot"
    );
    return;
  }

  /* Resolve into an absolute path, given directory is relative to __dirname */
  const absolutePath = path.resolve(__dirname, "assignments", directory);

  /* Ensure that the directory exists */
  if (!fs.existsSync(absolutePath)) {
    signale.error("Directory or zip file does not exist");
    return;
  }

  clearAndEnsureWorkingDirectory();
  clearAndEnsureLogsDirectory();

  /* If the absolute path is a zip file, then we need to unzip it */
  if (absolutePath.includes(".zip")) {
    signale.info("Unzipping the file");

    await fs
      .createReadStream(absolutePath)
      .pipe(
        unzipper.Extract({
          path: WORKING_DIRECTORY,
        })
      )
      .on("entry", (entry) => {
        console.log(entry);
        entry.autodrain();
      })
      .promise();

    signale.success("Unzipping complete");
  } else {
    /* We are dealing with a directory, make a copy of it and move it to the working directory */
    signale.info("Copying the directory to the working directory");

    fs.cpSync(absolutePath, WORKING_DIRECTORY, { recursive: true });
  }

  /**
   * At this point, we should have the contents of the directory
   * or the zip file in the working directory. We are now ready
   * to find all of the package.json files (not inside node_modules)
   * as this will form the root of our projects that need their dependencies
   * installed.
   */
  const packageJSONPaths = [];

  signale.await("Finding all package.json files");

  await Walk.walk(WORKING_DIRECTORY, async (err, pathname, dirent) => {
    if (dirent.name === ".git") {
      return false;
    }

    if (dirent.name === "node_modules") {
      return false;
    }

    if (dirent.name === "package.json") {
      packageJSONPaths.push(pathname);
    }
  });

  signale.success(`Found ${packageJSONPaths.length} package.json files`);

  for (const packageJSONPath of packageJSONPaths) {
    await installDependencies(packageJSONPath);
  }

  signale.success("All dependencies installed");

  /* Finally, let's boot each of the projects */
  signale.await("Booting each project");

  for (const packageJSONPath of packageJSONPaths) {
    await bootProject(packageJSONPath);
  }
}

/**
 * This function clears the working directory,
 * recreating it if it does not exist so that it
 * is ready for the next assignment.
 */
function clearAndEnsureWorkingDirectory() {
  /* Clear our working directory */
  signale.info("Clearing working directory");

  /* Delete it if it exists */
  if (fs.existsSync(WORKING_DIRECTORY)) {
    fs.rmdirSync(WORKING_DIRECTORY, { recursive: true });
  }

  /* Create the directory */
  fs.mkdirSync(WORKING_DIRECTORY);

  signale.success("Working directory is ready");
}

/**
 * This function clears the logs directory,
 * recreating it if it does not exist so that it
 * is ready for the next assignment.
 */
function clearAndEnsureLogsDirectory() {
  /* Clear our directory */
  signale.info("Clearing logs directory");

  /* Delete it if it exists */
  if (fs.existsSync(LOGS_DIRECTORY)) {
    fs.rmdirSync(LOGS_DIRECTORY, { recursive: true });
  }

  /* Create the directory */
  fs.mkdirSync(LOGS_DIRECTORY);

  signale.success("Logs directory is ready");
}

/**
 * This functions takes a package.json file path and installs
 * the dependencies using pnpm.
 *
 * We use the prefer-offline flag to ensure that we are not hitting
 * the network to install dependencies unless absolutely required.
 * This makes the install process much faster.
 */
async function installDependencies(packageJSONPath) {
  signale.await(`Installing dependencies for ${packageJSONPath}`);

  /* Determine the parent path of the package.json file */
  const parentPath = path.dirname(packageJSONPath);

  /* Now that we have the parent path, let's install the dependencies */
  shell_exec(`npx --yes pnpm i --prefer-offline`, {
    stdio: "inherit",
    cwd: parentPath,
  });

  signale.success(`Dependencies installed for ${packageJSONPath}`);
}

/**
 * This function boots a project by looking for either a dev or start script
 * in the package.json file. If it finds one, it will run it,
 * in the background (but with output sent to the console).
 */
async function bootProject(packageJSONPath) {
  /* Determine the parent path of the package.json file */
  const parentPath = path.dirname(packageJSONPath);

  /* Read the package.json file */
  const packageJSON = JSON.parse(fs.readFileSync(packageJSONPath));

  let scriptToRun = "";

  /* See if we have a start script */
  if (packageJSON.scripts?.start) {
    scriptToRun = "start";
  }

  /* See if we have a dev script */
  if (packageJSON.scripts?.dev) {
    scriptToRun = "dev";
  }

  /* Ensure that we do have a script to run */
  if (!scriptToRun) {
    throw new Error(`No start or dev script found in ${packageJSONPath}`);
  }

  /* Finally, run the project */
  signale.info(`Booting project in ${parentPath}`);

  /* From the parent path get the name of the directory */
  const dirName = parentPath.split(path.sep).pop();

  const command = spawn("npm", ["run", scriptToRun], {
    cwd: parentPath,
  });

  /* Print the output of the command to log files as well as stdout */
  command.stdout.on("data", function (data) {
    fs.appendFileSync(
      path.resolve(__dirname, "logs", `${dirName}.log`),
      data.toString()
    );

    signale.info(`${packageJSON.name}:` + data.toString());
  });

  command.stderr.on("data", function (data) {
    fs.appendFileSync(
      path.resolve(__dirname, "logs", `${dirName}.log`),
      `ERROR: ${data.toString()}`
    );

    signale.error(`${packageJSON.name}:` + data.toString());
  });

  command.on("exit", function (code) {
    if (code === 0) {
      signale.success(`${packageJSON.name} exited successfully`);
      return;
    }

    signale.error(`${packageJSON.name} exited with code ${code}`);
  });
}

run();
