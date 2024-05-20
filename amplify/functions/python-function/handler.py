import os
import json
import boto3

# GRAPHQL_API_ID in environment variables

def lambda_handler(event, context):
    # Retrieve data from the event
    # For example, if the event is a JSON payload:
    payload = json.loads(event['body'])

    graphql_api_id = os.environ['GRAPHQL_API_ID']

    # connect to graphql appsync
    client = boto3.client('appsync')

    r = client.get_graphql_api(apiId=graphql_api_id)
    
    # Perform your logic here
    # For example, you can process the payload and return a response
    response = {
        'statusCode': 200,
        'headers': {
            'Access-Control-Allow-Origin': '*',  # Replace * with your desired origin
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': '*'  # Add any additional allowed methods
        },
        'body': json.dumps(r)
    }
    
    return response