To query for individual records 

curl --location 'http://localhost:3000/graphql' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer YOUR TOKEN' \
--data '{
    "query": "query { getProducts(id: \"1\") { product_name description category_id } }"
}'


To Query for all records 

curl --location 'http://localhost:3000/graphql' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer YOURTOKEN' \
--data '{
    "query": "query { getAllProducts { product_name } }"
}'