import json

def lambda_handler(event, context):
    # Retrieve data from the event
    # For example, if the event is a JSON payload:
    payload = json.loads(event['body'])
    
    # Perform your logic here
    # For example, you can process the payload and return a response
    response = {
        'statusCode': 200,
        'body': 'Hello from AWS Lambda!'
    }
    
    return response