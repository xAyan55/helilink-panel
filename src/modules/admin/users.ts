import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import { onlineUsers } from '../user/wsUsers';
import logger from '../../handlers/logger';
import { getParamAsNumber } from '../../utils/typeHelpers';


async function listUsers(res: Response) {
  try {
    const users = await prisma.users.findMany({
      include: {
        servers: true
      }
    });

    return users;
  } catch (error) {
    logger.error('Error fetching users:', error);
    res.status(500).json({ message: 'Error fetching users.' });
  }
}

const adminModule: Module = {
  info: {
    name: 'Admin Users Module',
    description: 'This file is for admin functionality of the Users.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author:        'HeliLink',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get(
      '/admin/users',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const users = await listUsers(res);
          const settings = await prisma.settings.findUnique({
            where: { id: 1 },
          });

          res.render('admin/users/users', {
            user,
            req,
            settings,
            users,
            onlineUsers,
          });
        } catch (error) {
          logger.error('Error fetching user:', error);
          return res.redirect('/login');
        }
      },
    );

    router.get(
      '/admin/users/create',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }
          const settings = await prisma.settings.findUnique({
            where: { id: 1 },
          });

          res.render('admin/users/create', { user, req, settings });
        } catch (error) {
          logger.error('Error fetching user:', error);
          return res.redirect('/login');
        }
      },
    );

    router.post(
      '/admin/users/create-user',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        const { discordId, username, isAdmin } = req.body;

        if (!discordId || !username) {
          res.status(400).json({
            message: 'Missing required fields: Discord ID and username.',
          });
          return;
        }

        if (!/^\d+$/.test(String(discordId).trim())) {
          res.status(400).json({
            message: 'Discord ID must be a numeric string.',
          });
          return;
        }

        const cleanDiscordId = String(discordId).trim();

        if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) {
          res.status(400).json({
            message: 'Username must be 3–20 characters and contain only letters and numbers.',
          });
          return;
        }

        const isAdminBool = typeof isAdmin === 'boolean' ? isAdmin : isAdmin === 'true';

        try {
          const existingUser = await prisma.users.findFirst({
            where: {
              OR: [{ discord_id: cleanDiscordId }, { username }],
            },
          });

          if (existingUser) {
            if (existingUser.discord_id === cleanDiscordId) {
              res.status(400).json({ message: 'Discord ID already exists.' });
            } else {
              res.status(400).json({ message: 'Username already exists.' });
            }
            return;
          }

          await prisma.users.create({
            data: {
              email: `${username}@discord.local`,
              username,
              password: null,
              discord_id: cleanDiscordId,
              isAdmin: isAdminBool,
            },
          });

          res.status(200).json({ message: 'User created successfully.' });
          return;
        } catch (error) {
          logger.error('Error creating user:', error);
          res
            .status(500)
            .json({ message: 'Error creating user. Please try again later.' });
          return;
        }
      },
    );

    router.get(
      '/admin/users/view/:id/',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const dataUser = await prisma.users.findUnique({
            where: { id: getParamAsNumber(req.params.id) },
            include: {
              servers: true
            }
          });
          if (!dataUser) {
            return res.redirect('/admin/users');
          }
          const settings = await prisma.settings.findUnique({
            where: { id: 1 },
          });

          res.render('admin/users/user', { user, req, settings, dataUser });
        } catch (error) {
          logger.error('Error fetching user:', error);
          return res.redirect('/login');
        }
      },
    );

    router.get(
      '/admin/users/edit/:id/',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const dataUser = await prisma.users.findUnique({
            where: { id: getParamAsNumber(req.params.id) },
            include: {
              servers: true
            }
          });
          if (!dataUser) {
            return res.redirect('/admin/users');
          }

          const settings = await prisma.settings.findUnique({
            where: { id: 1 },
          });

          res.render('admin/users/edit', { user, req, settings, dataUser });
        } catch (error) {
          logger.error('Error fetching user:', error);
          return res.redirect('/login');
        }
      },
    );

    router.delete(
      '/admin/users/delete/:id/',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const dataUser = await prisma.users.findUnique({
            where: { id: getParamAsNumber(req.params.id) },
          });
          if (!dataUser) {
            return res.redirect('/admin/users');
          }

          await prisma.users.delete({
            where: { id: getParamAsNumber(req.params.id) },
          });

          res.status(200).json({ message: 'User deleted successfully.' });
        } catch (error) {
          logger.error('Error deleting user:', error);
          return res.redirect('/login');
        }
      },
    );

    router.post(
      '/admin/users/update/:id/',
      isAuthenticated(true),
      async (req: Request, res: Response): Promise<void> => {
        try {
          const userId = req.session?.user?.id;
          const adminUser = await prisma.users.findUnique({ where: { id: userId } });
          if (!adminUser) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
          }

          const targetUserId = getParamAsNumber(req.params.id);
          const targetUser = await prisma.users.findUnique({
            where: { id: targetUserId },
          });

          if (!targetUser) {
            res.status(404).json({ error: 'User not found' });
            return;
          }

          const { discordId, username, description, isAdmin, serverLimit, maxMemory, maxCpu, maxStorage } = req.body;

          if (discordId !== undefined) {
            const cleanDiscordId = String(discordId).trim();
            if (cleanDiscordId === '') {
              res.status(400).json({ error: 'Discord ID cannot be empty.' });
              return;
            }
            if (!/^\d+$/.test(cleanDiscordId)) {
              res.status(400).json({ error: 'Discord ID must be a numeric string.' });
              return;
            }

            const existingUserWithDiscordId = await prisma.users.findFirst({
              where: {
                discord_id: cleanDiscordId,
                id: { not: targetUserId }
              },
            });

            if (existingUserWithDiscordId) {
              res.status(400).json({ error: 'Discord ID already in use' });
              return;
            }
          }

          if (username) {
            if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) {
              res.status(400).json({ error: 'Username must be 3–20 characters and contain only letters and numbers.' });
              return;
            }

            const existingUserWithUsername = await prisma.users.findFirst({
              where: {
                username,
                id: { not: targetUserId }
              },
            });

            if (existingUserWithUsername) {
              res.status(400).json({ error: 'Username already in use' });
              return;
            }
          }

          // Prepare update data
          const updateData: any = {};

          if (discordId !== undefined) {
            updateData.discord_id = String(discordId).trim();
          }
          if (username) {
            updateData.username = username;
            if (!targetUser.discord_email) {
              updateData.email = `${username}@discord.local`;
            }
          }
          if (description !== undefined) updateData.description = description;

          // Handle isAdmin field (convert to boolean)
          if (isAdmin !== undefined) {
            updateData.isAdmin = isAdmin === true || isAdmin === 'true';
          }

          // Handle optional resource limits — null means "use global default"
          if (serverLimit !== undefined) {
            updateData.serverLimit = serverLimit === '' || serverLimit === null ? null : parseInt(serverLimit, 10);
          }
          if (maxMemory !== undefined) {
            updateData.maxMemory = maxMemory === '' || maxMemory === null ? null : parseInt(maxMemory, 10);
          }
          if (maxCpu !== undefined) {
            updateData.maxCpu = maxCpu === '' || maxCpu === null ? null : parseInt(maxCpu, 10);
          }
          if (maxStorage !== undefined) {
            updateData.maxStorage = maxStorage === '' || maxStorage === null ? null : parseInt(maxStorage, 10);
          }

          // Update user
          await prisma.users.update({
            where: { id: targetUserId },
            data: updateData,
          });

          res.status(200).json({ message: 'User updated successfully' });
        } catch (error) {
          logger.error('Error updating user:', error);
          res.status(500).json({ error: 'Internal server error' });
        }
      },
    );

    return router;
  },
};


export default adminModule;
