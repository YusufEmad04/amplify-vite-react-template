import os
import json
import boto3

# GRAPHQL_API_ID in environment variables

def lambda_handler(event, context):
    # Retrieve data from the event
    # For example, if the event is a JSON payload:
    print(event)
    auth = event['headers']['Authorization']

    graphql_api_id = os.environ['GRAPHQL_API_ID']

    # connect to graphql appsync
    client = boto3.client('appsync')

    r = client.get_graphql_api(apiId=graphql_api_id)

    graphql_url = r['graphqlApi']['uris']['GRAPHQL']
    
    # Perform your logic here
    # For example, you can process the payload and return a response
    response = {
        'statusCode': 200,
        'headers': {
            'Access-Control-Allow-Origin': '*',  # Replace * with your desired origin
            'Access-Control-Allow-Headers': '*',
            'Content-Type': 'application/json'
        },
        'body': json.dumps({
            "graphql_url": graphql_url,
            "auth": auth
        })
    }
    
    return response