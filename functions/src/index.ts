import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

admin.initializeApp(functions.config().firebase);

const GRAPHQL_ENDPOINT = 'https://eat-that-list.herokuapp.com/v1/graphql';

interface GraphQLRequest {
  query: string;
  variables: {};
}

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

  await sendGraphqlRequest(graphqlInsertUserRequest);

  return admin
    .auth()
    .setCustomUserClaims(user.uid, customClaims)
    .then(() => {
      const metadataRef = admin.database().ref(`metadata/${user.uid}`);
      return metadataRef.set({ refreshTime: new Date().getTime() });
    })
    .catch(console.log);
});

export const addOwnerListAccess = functions.https.onRequest(
  async (req, res) => {
    const reqSecret = req.get('x-hasura-admin-secret');
    if (reqSecret !== functions.config().hasura.admin.secret) {
      console.log(
        'Unauthenticated call to this endpoint',
        req.body,
        req.headers
      );
      res.end();
    }

    const listId = req.body.event.data.new.id;
    const userId = req.body.event.session_variables['x-hasura-user-id'];

    const addOwnerQuery = `
      mutation($listId: Int!, $userId: String!) {
        insert_ListAccess(objects: [{ list_id: $listId, user_id: $userId }]) {
          affected_rows
        }
      }
    `;
    const graphqlAddOwnerRequest = {
      query: addOwnerQuery,
      variables: {
        listId,
        userId,
      },
    };

    let retries = 0;
    let result = await sendGraphqlRequest(graphqlAddOwnerRequest);

    while (result.status !== 200) {
      retries = retries + 1;
      console.log(
        `Problem sending request to Hasura.  Proceeding with retry ${retries}`,
        result.data
      );
      result = await sendGraphqlRequest(graphqlAddOwnerRequest);
    }

    res.end();
  }
);

const sendGraphqlRequest = (request: GraphQLRequest) => {
  return axios.post(GRAPHQL_ENDPOINT, JSON.stringify(request), {
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': `${functions.config().hasura.admin.secret}`,
    },
  });
};
