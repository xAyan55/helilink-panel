import { Router, Request, Response } from 'express';
import { Module } from '../../handlers/moduleInit';
import prisma from '../../db';
import { isAuthenticated } from '../../handlers/utils/auth/authUtil';
import { checkNodeStatus } from '../../handlers/utils/node/nodeStatus';
import logger from '../../handlers/logger';
import axios from 'axios';
import { getParamAsNumber } from '../../utils/typeHelpers';
import { daemonSchemeSync } from '../../handlers/utils/core/daemonRequest';
import { parseAllocatedPorts, AllocatedPort } from '../../handlers/utils/server/ports';



function generateApiKey(length: number): string {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters[randomIndex];
  }
  return result;
}

type NodeWithInstances = {
  id: number;
  name: string;
  ram: number;
  cpu: number;
  disk: number;
  address: string;
  port: number;
  key: string;
  createdAt: Date;
  instances: any[];
  servers?: any[]; // For port allocation UI
}

async function listNodes(res: Response, includeServers = false) {
  try {
    const nodes = await prisma.node.findMany();
    const nodesWithStatus = [];

    for (const node of nodes) {
      const instances = await prisma.server.findMany({
        where: { nodeId: node.id },
      });

      const nodeWithInstances: NodeWithInstances = {
        ...node,
        instances,
        ...(includeServers ? { servers: instances } : {}),
      };

      nodesWithStatus.push(await checkNodeStatus(nodeWithInstances));
    }

    return nodesWithStatus;
  } catch (error) {
    logger.error('Error fetching nodes:', error);
    res.status(500).json({ message: 'Error fetching nodes.' });
  }
}

const adminModule: Module = {
  info: {
    name: 'Admin Nodes Module',
    description: 'This file is for admin functionality of the Nodes.',
    version: '2.0.0',
    moduleVersion: '1.0.0',
    author:        'HeliLink',
    license: 'MIT',
  },

  router: () => {
    const router = Router();

    router.get(
      '/admin/nodes',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const nodes = await listNodes(res);

          const instance = await prisma.server.findMany();
          const settings = await prisma.settings.findUnique({
            where: { id: 1 },
          });

          res.render('admin/nodes/nodes', {
            user,
            req,
            settings,
            nodes,
            instance,
          });
        } catch (error) {
          logger.error('Error fetching user:', error);
          return res.redirect('/login');
        }
      },
    );

    router.get(
      '/admin/nodes/create',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const nodes = await listNodes(res);

          const settings = await prisma.settings.findUnique({
            where: { id: 1 },
          });
          res.render('admin/nodes/create', { user, req, settings, nodes });
        } catch (error) {
          logger.error('Error fetching user:', error);
          return res.redirect('/login');
        }
      },
    );

    router.get(
      '/admin/nodes/list',
      isAuthenticated(true),
      async (_req: Request, res: Response) => {
        // Include servers data for port allocation UI
        const listNode = await listNodes(res, true);
        res.json(listNode);
      },
    );

    router.post(
      '/admin/nodes/create',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        const { name, ram, cpu, disk, address, port } = req.body;

        if (!name || typeof name !== 'string') {
          res.status(400).json({ message: 'Name must be a string.' });
          return;
        } else if (name.length < 3 || name.length > 50) {
          res.status(400).json({
            message: 'Name must be between 3 and 50 characters long.',
          });
          return;
        }

        if (!ram || isNaN(parseInt(ram)) || parseInt(ram) <= 0) {
          res.status(400).json({ message: 'RAM must be a positive number.' });
          return;
        }

        if (!cpu || isNaN(parseInt(cpu)) || parseInt(cpu) <= 0) {
          res.status(400).json({ message: 'CPU must be a positive number.' });
          return;
        }

        if (!disk || isNaN(parseInt(disk)) || parseInt(disk) <= 0) {
          res.status(400).json({ message: 'Disk must be a positive number.' });
          return;
        }

        const addressRegex =
          /^(localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})$/;
        if (
          !address ||
          typeof address !== 'string' ||
          !addressRegex.test(address)
        ) {
          res.status(400).json({
            message: 'Address must be a valid IPv4, domain, or localhost.',
          });
          return;
        }

        if (
          !port ||
          isNaN(parseInt(port)) ||
          parseInt(port) <= 1024 ||
          parseInt(port) > 65535
        ) {
          res
            .status(400)
            .json({ message: 'Port must be a number between 1025 and 65535.' });
          return;
        }

        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            res.status(403).json({ message: 'Unauthorized access.' });
            return;
          }

          const key = generateApiKey(32);

          const ramValue = parseFloat(ram);
          const cpuValue = parseFloat(cpu);
          const diskValue = parseFloat(disk);
          const portValue = parseInt(port);

          const node = await prisma.node.create({
            data: {
              name,
              ram: ramValue,
              cpu: cpuValue,
              disk: diskValue,
              address,
              port: portValue,
              key,
              createdAt: new Date(),
            },
          });

          res.status(200).json({ message: 'Node created successfully.', node });
          return;
        } catch (error) {
          logger.error('Error when creating the node:', error);
          res.status(500).json({ message: 'Error when creating the node.' });
          return;
        }
      },
    );

    router.delete(
      '/admin/node/:id',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const nodeId = getParamAsNumber(req.params.id);
          const deleteInstances = req.query.deleteInstance === 'true';

          try {
            if (deleteInstances) {
              const node = await prisma.node.findUnique({
                where: { id: nodeId },
                include: { servers: true },
              });

              if (node) {
                await Promise.allSettled(
                  node.servers.map((server) =>
                    axios.delete(
                      `${daemonSchemeSync()}://${node.address}:${node.port}/container`,
                      {
                        auth: { username: 'Airlink', password: node.key },
                        data: { id: server.UUID },
                        timeout: 8000,
                      },
                    ),
                  ),
                );
              }

              await prisma.server.deleteMany({
                where: { nodeId: nodeId },
              });
            }

            await prisma.node.delete({ where: { id: nodeId } });

            res.status(200).json({
              message: deleteInstances
                ? 'Node and associated instances deleted successfully.'
                : 'Node deleted successfully.',
            });
          } catch (error) {
            logger.error('Error when deleting the node:', error);
            res.status(500).json({ message: 'Error when deleting the node.' });
          }
        } catch (error) {
          logger.error('Error fetching user:', error);
          return res.redirect('/login');
        }
      },
    );

    router.get(
      '/admin/node/:id/configure',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const nodeId = getParamAsNumber(req.params.id);

          const node = await prisma.node.findUnique({ where: { id: nodeId } });
          if (!node) {
            res.status(404).json({ message: 'Node not found.' });
            return;
          }

          res
            .status(200)
            .json(
              'configure -- -- --panel "' +
                process.env.URL +
                '" --key "' +
                node.key +
                '"',
            );
          return;
        } catch (error) {
          logger.error('Error fetching user:', error);
          return res.redirect('/login');
        }
      },
    );

    router.get(
      '/admin/node/:id',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const nodeId = getParamAsNumber(req.params.id);

          // Get node with its servers for port allocation UI
          const node = await prisma.node.findUnique({
            where: { id: nodeId },
            include: {
              servers: true
            }
          });

          if (!node) {
            res.status(404).json({ message: 'Node not found.' });
            return;
          }

          const settings = await prisma.settings.findUnique({
            where: { id: 1 },
          });

          res.render('admin/nodes/edit', { node, user, req, settings });
        } catch (error) {
          logger.error('Error fetching user:', error);
          return res.redirect('/login');
        }
      },
    );

    router.put(
      '/admin/node/:id/edit',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        try {
          const userId = req.session?.user?.id;
          const user = await prisma.users.findUnique({ where: { id: userId } });
          if (!user) {
            return res.redirect('/login');
          }

          const nodeId = getParamAsNumber(req.params.id);

          const name = req.body.name;
          const ram = parseInt(req.body.ram);
          const cpu = parseInt(req.body.cpu);
          const disk = parseInt(req.body.disk);
          const address = req.body.address;
          const port = parseInt(req.body.port);

          if (
            !name ||
            isNaN(ram) ||
            isNaN(cpu) ||
            isNaN(disk) ||
            !address ||
            !port
          ) {
            res.status(400).json({
              message:
                'All fields are required and numeric values must be valid numbers.',
            });
            return;
          }

          const existingNode = await prisma.node.findUnique({
            where: { id: nodeId },
          });

          if (!existingNode) {
            res.status(404).json({ message: 'Node not found.' });
            return;
          }

          const updateData: any = {
            name,
            ram,
            cpu,
            disk,
            address,
            port,
          };

          const incomingPortsRaw = req.body.allocatedPorts;
          let isModified = true;

          if (incomingPortsRaw !== undefined) {
            function areRawPortsEqual(a: any[], b: any[]): boolean {
              if (a.length !== b.length) return false;
              for (let i = 0; i < a.length; i++) {
                const itemA = a[i];
                const itemB = b[i];
                if (typeof itemA !== typeof itemB) return false;
                if (itemA && typeof itemA === 'object' && itemB && typeof itemB === 'object') {
                  if (itemA.port !== itemB.port) return false;
                  if (itemA.alias !== itemB.alias) return false;
                } else {
                  if (itemA !== itemB) return false;
                }
              }
              return true;
            }

            try {
              const currentParsed = JSON.parse(existingNode.allocatedPorts || '[]');
              const incomingParsed = JSON.parse(incomingPortsRaw);
              if (Array.isArray(currentParsed) && Array.isArray(incomingParsed)) {
                if (areRawPortsEqual(currentParsed, incomingParsed)) {
                  isModified = false;
                }
              }
            } catch (e) {
              // fallback to normal validation
            }
          } else {
            isModified = false;
          }

          if (isModified && incomingPortsRaw !== undefined) {
            try {
              const parsed = JSON.parse(incomingPortsRaw);
              if (!Array.isArray(parsed)) {
                res.status(400).json({ message: 'Invalid allocated ports format: Must be an array' });
                return;
              }

              const seenPorts = new Set<number>();
              const normalizedPorts: AllocatedPort[] = [];

              for (const item of parsed) {
                let rawPortVal: any = null;
                let rawAliasVal: any = null;
                let hasAlias = false;

                if (item && typeof item === 'object') {
                  rawPortVal = item.port;
                  if ('alias' in item) {
                    rawAliasVal = item.alias;
                    hasAlias = true;
                  }
                } else {
                  rawPortVal = item;
                }

                let portNum: number;
                if (typeof rawPortVal === 'number' && Number.isInteger(rawPortVal)) {
                  portNum = rawPortVal;
                } else if (typeof rawPortVal === 'string') {
                  if (/^\d+$/.test(rawPortVal)) {
                    portNum = parseInt(rawPortVal, 10);
                  } else {
                    res.status(400).json({ message: `Invalid port number: ${rawPortVal}` });
                    return;
                  }
                } else {
                  res.status(400).json({ message: `Invalid port number: ${rawPortVal}` });
                  return;
                }

                if (portNum < 1 || portNum > 65535) {
                  res.status(400).json({ message: `Invalid port number: ${portNum}` });
                  return;
                }

                if (seenPorts.has(portNum)) {
                  res.status(400).json({ message: `Duplicate port detected: ${portNum}` });
                  return;
                }
                seenPorts.add(portNum);

                let aliasStr: string | null = null;
                if (hasAlias && rawAliasVal !== undefined) {
                  if (typeof rawAliasVal === 'string') {
                    const trimmed = rawAliasVal.trim();
                    if (rawAliasVal !== '' && trimmed === '') {
                      res.status(400).json({ message: 'Alias cannot consist only of whitespace' });
                      return;
                    }
                    if (trimmed === '') {
                      aliasStr = null;
                    } else {
                      if (trimmed.length > 50) {
                        res.status(400).json({ message: 'Each alias must be 50 characters or less' });
                        return;
                      }
                      const lower = trimmed.toLowerCase();
                      if (lower === 'null' || lower === 'undefined' || lower === 'nan') {
                        res.status(400).json({ message: `Alias contains reserved word: ${trimmed}` });
                        return;
                      }
                      aliasStr = trimmed;
                    }
                  } else if (rawAliasVal === null) {
                    aliasStr = null;
                  } else {
                    res.status(400).json({ message: 'Alias must be a string' });
                    return;
                  }
                }

                normalizedPorts.push({ port: portNum, alias: aliasStr });
              }

              updateData.allocatedPorts = JSON.stringify(normalizedPorts);
            } catch (error: any) {
              res.status(400).json({
                message: 'Invalid allocated ports format: ' + (error.message || 'Unknown error'),
              });
              return;
            }
          }

          const node = await prisma.node.update({
            where: { id: nodeId },
            data: updateData,
          });

          res.status(200).json({ message: 'Node updated successfully.', node });
          return;
        } catch (error) {
          logger.error('Error when updating the node:', error);
          res.status(500).json({ message: 'Error when updating the node.' });
          return;
        }
      },
    );

    router.get(
      '/admin/node/:id/stats',
      isAuthenticated(true),
      async (req: Request, res: Response) => {
        const userId = req.session?.user?.id;
        const user = await prisma.users.findUnique({ where: { id: userId } });
        if (!user) {
          return res.redirect('/login');
        }

        const nodeId = getParamAsNumber(req.params.id);

        const node = await prisma.node.findUnique({ where: { id: nodeId } });
        if (!node) {
          res.status(404).json({ message: 'Node not found.' });
          return;
        }

        const settings = await prisma.settings.findUnique({
          where: { id: 1 },
        });

        let stats: Record<string, unknown>;

        try {
          const response = await axios.get(
            `${daemonSchemeSync()}://${node.address}:${node.port}/stats`,
            {
              auth: {
                username: 'Airlink',
                password: node.key,
              },
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );

          stats = response.data;
        } catch {
          stats = { error: 'Unable to fetch stats from the node.' };
        }
        res.render('admin/nodes/stats', { node, user, req, settings, stats });
      }
    );


    return router;
  },
};


export default adminModule;
