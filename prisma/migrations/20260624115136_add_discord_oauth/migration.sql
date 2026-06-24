-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT,
    "username" TEXT,
    "password" TEXT,
    "discord_id" TEXT,
    "discord_username" TEXT,
    "discord_display_name" TEXT,
    "discord_avatar" TEXT,
    "discord_email" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT DEFAULT 'No About Me',
    "avatar" TEXT,
    "permissions" TEXT DEFAULT '[]',
    "serverLimit" INTEGER DEFAULT 0,
    "maxMemory" INTEGER DEFAULT 0,
    "maxCpu" INTEGER DEFAULT 0,
    "maxStorage" INTEGER DEFAULT 0,
    "loginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Users" ("avatar", "createdAt", "description", "email", "id", "isAdmin", "lockedUntil", "loginAttempts", "maxCpu", "maxMemory", "maxStorage", "password", "permissions", "serverLimit", "updatedAt", "username") SELECT "avatar", "createdAt", "description", "email", "id", "isAdmin", "lockedUntil", "loginAttempts", "maxCpu", "maxMemory", "maxStorage", "password", "permissions", "serverLimit", "updatedAt", "username" FROM "Users";
DROP TABLE "Users";
ALTER TABLE "new_Users" RENAME TO "Users";
CREATE UNIQUE INDEX "Users_email_key" ON "Users"("email");
CREATE UNIQUE INDEX "Users_username_key" ON "Users"("username");
CREATE UNIQUE INDEX "Users_discord_id_key" ON "Users"("discord_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
