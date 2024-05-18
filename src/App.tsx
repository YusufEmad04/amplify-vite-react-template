import { useEffect, useState } from "react";
import type { Schema } from "../amplify/data/resource";
import { generateClient } from "aws-amplify/data";
import { Authenticator } from '@aws-amplify/ui-react'
// import { get } from 'aws-amplify/api';
import { fetchAuthSession } from "aws-amplify/auth";
import '@aws-amplify/ui-react/styles.css'

const client = generateClient<Schema>();

async function getAuthSession() {
  try {
    const session = await fetchAuthSession();
    console.log('GET call succeeded: ', session);
  } catch (error) {
    console.log('GET call failed: ', error);
  }
}

// async function getItem() {
//   try {
//     const restOperation = get({ 
//       apiName: 'myRestApi',
//       path: 'cognito-auth-path' 
//     });
//     const response = await restOperation.response;
//     console.log('GET call succeeded: ', response);
//   } catch (error) {
//     console.log('GET call failed: ', JSON.parse(error.response.body));
//   }
// }

function App() {
  const [todos, setTodos] = useState<Array<Schema["Todo"]["type"]>>([]);

  useEffect(() => {
    getAuthSession();
    client.models.Todo.observeQuery().subscribe({
      next: (data) => setTodos([...data.items]),
    });
  }, []);

  function createTodo() {
    client.models.Todo.create({ content: window.prompt("Todo content") });
  }

  function deleteTodo(id: string) {
    client.models.Todo.delete({ id })
  }

  return (
    <Authenticator>
      {function({signOut, user}) {
        console.log(user);
        return (
          <main>
            <h1>My todos</h1>
            <button onClick={createTodo}>+ new</button>
            <ul>
              {todos.map((todo) => (
                <li onClick={() => deleteTodo(todo.id)} key={todo.id}>{todo.content}</li>
              ))}
            </ul>
            <div>
              🥳 App successfully hosted. Try creating a new todo.
              <br />
              <a href="https://docs.amplify.aws/react/start/quickstart/#make-frontend-updates">
                Review next step of this tutorial.
              </a>
            </div>
            <button onClick={signOut}>Sign out</button>
          </main>
        );
      }}
    </Authenticator>
  );
}

export default App;
