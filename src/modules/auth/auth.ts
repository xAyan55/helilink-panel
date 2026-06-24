import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';

const authModule: Module = {
  info: {
    name: 'Auth Module',
    description: 'Renders login screens for user authentication.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author:        'HeliLink',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get('/login', async (req: Request, res: Response) => {
      const settings = await prisma.settings.findUnique({ where: { id: 1 } });
      res.render('auth/login', { req, settings });
    });

    return router;
  },
};

export default authModule;
