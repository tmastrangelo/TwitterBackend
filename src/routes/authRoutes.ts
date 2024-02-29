import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import jwt from 'jsonwebtoken';
import { sendEmailToken } from "../services/emailService";

const EMAIL_TOKEN_EXPIRATION_MINUTES = 10;
const AUTHENTICATION_EXPIRATION_DAYS = 30;
const JWT_SECRET = process.env.JWT_SECRET || 'SUPER SECRET';

const router = Router();
const prisma = new PrismaClient();

// Generate a random 8 digit number as the email token
function  generateEmailToken(): string {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

function generateAuthToken(tokenId: number): string {
  const jwtPayload = { tokenId };

  return jwt.sign(jwtPayload, JWT_SECRET, {
    algorithm: "HS256",
    noTimestamp: true,
  })
}

// Create a user. If it doesn't exist, 
// generate the emailToken and send it to their email
router.post('/login', async (req, res) => {
  const {email} = req.body;
  const user = await prisma.user.findUnique({ where: { email } });

  if (user && !user.username) {
    // User exists but doesn't have a username
    return res.status(400).json({ error: "Username required" });
  }

  // generate token
  const emailToken = generateEmailToken();
  const expiration = new Date(
    new Date().getTime() + EMAIL_TOKEN_EXPIRATION_MINUTES * 60 * 1000 // sets expiration time to 10 minutes (in milliseconds)
  );

  try {
    const createdToken = await prisma.token.create({
      data: {
          type: "EMAIL",
          emailToken,
          expiration,
          user: {
              connectOrCreate: {
                  where: { email },
                  create: { email },
              },
          },
      },
    });
  
    console.log(createdToken);
    // TODO send emailToken to user's email
    await sendEmailToken(email, emailToken);
    res.sendStatus(200);
  } catch (e) {
    console.log(e);
    res.status(400).json({error: "Couldn't start the authentication process"});
  }
})

// Validate the emailToken
// Generate a long-lived JWT token
router.post('/authenticate', async (req, res) => {
  const {email, emailToken} = req.body;

  const dbEmailToken = await prisma.token.findUnique({
    where: {
      emailToken,
    },
    include: {
      user: true
    },
  });

  if ( !dbEmailToken || !dbEmailToken.valid ) {
    return res.sendStatus(401);
  }

  if (dbEmailToken.expiration < new Date()) {
    return res.status(401).json({error: "Token expired!"});
  }

  if (dbEmailToken?.user?.email !== email) {
    return res.sendStatus(401);
  }

  // At this point, we validated that the user is the owner of the email

  // generate an API token
  const expiration = new Date(
    new Date().getTime() + AUTHENTICATION_EXPIRATION_DAYS * 30 * 24 * 60 * 60 * 1000 // sets expiration time to 30 days (in milliseconds)
  );

  const apiToken = await prisma.token.create({
    data: {
      type: "API",
      expiration,
      user: {
        connect: {
          email,
        },
      },
    },
  });

  // Invalidate the email
  await prisma.token.update({
    where: { id: dbEmailToken.id },
    data: { valid: false },
  });

  // generate the JWT token
  const authToken = generateAuthToken(apiToken.id);

    
  res.json({authToken});
})

export default router;