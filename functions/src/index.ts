import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

admin.initializeApp(functions.config().firebase);

const GRAPHQL_ENDPOINT = 'https://eat-that-list.herokuapp.com/v1/graphql';

export const processSignUp = functions.auth.user().onCreate(async user => {
  const { uid: userId, email } = user;
  const customClaims = {
    'https://hasura.io/jwt/claims': {
      'x-hasura-default-role': 'user',
      'x-hasura-allowed-roles': ['user'],
      'x-hasura-user-id': user.uid,
    },
  };

  const insertUserQuery = `
    mutation($userId: String!, $email: String!) {
      insert_Users(objects: [{ id: $userId, email: $email }]) {
        affected_rows
      }
    }
  `;
  const graphqlInsertUserRequest = {
    query: insertUserQuery,
    variables: {
      userId,
      email,
    },
  };
  await axios.post(GRAPHQL_ENDPOINT, JSON.stringify(graphqlInsertUserRequest), {
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': `${functions.config().hasura.admin.secret}`,
    },
  });

  return admin
    .auth()
    .setCustomUserClaims(user.uid, customClaims)
    .then(() => {
      const metadataRef = admin.database().ref(`metadata/${user.uid}`);
      return metadataRef.set({ refreshTime: new Date().getTime() });
    })
    .catch(console.log);
});
